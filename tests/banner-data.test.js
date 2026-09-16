/** @jest-environment node */
require('./web-globals');
jest.mock('server-only', () => ({}));
jest.mock('../src/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('../src/lib/douban', () => ({ fetchDoubanData: jest.fn() }));
jest.mock('../src/lib/tmdb.client', () => ({
  getTMDBTrendingContent: jest.fn(),
  getTMDBVideos: jest.fn(),
}));
jest.mock('../src/lib/logger', () => ({ logger: { error: jest.fn() } }));
jest.mock('next/headers', () => ({ cookies: async () => new Map() }));
jest.mock('../src/components/home/HomePageClient', () => ({
  __esModule: true,
  default: () => null,
}));

const item = {
  id: 42,
  title: 'Public banner',
  poster_path: '/poster.jpg',
  backdrop_path: '/backdrop.jpg',
  release_date: '2026-09-13',
  overview: 'Public description',
  vote_average: 8,
  media_type: 'movie',
  genre_ids: [18],
};
const originalFetch = global.fetch;
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};
let getConfig;
let getTMDBTrendingContent;
let getTMDBVideos;
let fetchDoubanData;
let service;
let config;

beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers('modern');
  ({ getConfig } = require('../src/lib/config'));
  ({
    getTMDBTrendingContent,
    getTMDBVideos,
  } = require('../src/lib/tmdb.client'));
  ({ fetchDoubanData } = require('../src/lib/douban'));
  config = {
    ConfigVersion: 1,
    SiteConfig: {
      BannerDataSource: 'TMDB',
      TMDBApiKey: 'server-secret',
      HomeBannerEnabled: true,
    },
  };
  getConfig.mockImplementation(async () => config);
  getTMDBTrendingContent.mockResolvedValue({ code: 200, list: [item] });
  getTMDBVideos.mockResolvedValue('trailer-key');
  service = require('../src/lib/server/banner-data');
});

afterEach(() => {
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
  global.fetch = originalFetch;
});

test('provides public server data with trailers without exposing config or extra upstream fields', async () => {
  getTMDBTrendingContent.mockResolvedValue({
    code: 200,
    list: [{ ...item, apiKey: 'server-secret', token: 'private-token' }],
    config,
  });
  const result = await service.getInitialBannerData();
  expect(result).toEqual({
    code: 200,
    list: [{ ...item, video_key: 'trailer-key' }],
    source: 'TMDB',
  });
  expect(JSON.stringify(result)).not.toContain('server-secret');
  expect(JSON.stringify(result)).not.toContain('private-token');
});

test('disabled banners skip upstream work even when there is a cached banner', async () => {
  await service.getBannerData();
  config = {
    ...config,
    SiteConfig: { ...config.SiteConfig, HomeBannerEnabled: false },
  };
  await expect(service.getInitialBannerData()).resolves.toBeNull();
  expect(getTMDBTrendingContent).toHaveBeenCalledTimes(1);
});

test('bounds initial rendering to 1500 ms including config reads and handles late rejection', async () => {
  const pending = deferred();
  getConfig.mockReturnValue(pending.promise);
  let settled = false;
  const initial = service.getInitialBannerData().then((value) => {
    settled = true;
    return value;
  });
  await flush();
  jest.advanceTimersByTime(1499);
  await flush();
  expect(settled).toBe(false);
  jest.advanceTimersByTime(1);
  await expect(initial).resolves.toBeNull();
  pending.reject(new Error('late config failure'));
  await flush();
  expect(getTMDBTrendingContent).not.toHaveBeenCalled();
});

test('an initial timeout keeps one shared fetch alive for the API and cache', async () => {
  const pending = deferred();
  getTMDBTrendingContent.mockReturnValue(pending.promise);
  const initial = service.getInitialBannerData({ timeoutMs: 25 });
  const api = service.getBannerData();
  await flush();
  expect(getTMDBTrendingContent).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(25);
  await expect(initial).resolves.toBeNull();
  pending.resolve({ code: 200, list: [item] });
  const result = await api;
  expect(result.list[0].title).toBe('Public banner');
  await expect(service.getInitialBannerData()).resolves.toEqual(result);
  expect(getTMDBTrendingContent).toHaveBeenCalledTimes(1);
});

test('configuration changes do not reuse a pending request or cached data with an old API key', async () => {
  const pending = deferred();
  getTMDBTrendingContent.mockImplementation((key) =>
    key === 'server-secret'
      ? pending.promise
      : Promise.resolve({
          code: 200,
          list: [{ ...item, title: 'New configured banner' }],
        })
  );
  const old = service.getBannerData();
  await flush();
  config = {
    ...config,
    SiteConfig: { ...config.SiteConfig, TMDBApiKey: 'replacement-secret' },
  };
  expect((await service.getBannerData()).list[0].title).toBe(
    'New configured banner'
  );
  pending.resolve({ code: 200, list: [item] });
  await old;
  expect((await service.getBannerData()).list[0].title).toBe(
    'New configured banner'
  );
  expect(getTMDBTrendingContent).toHaveBeenCalledTimes(2);
});

test('switches sources without returning cached TMDB entries for Douban', async () => {
  await service.getBannerData();
  config = { ...config, SiteConfig: { BannerDataSource: 'Douban' } };
  fetchDoubanData.mockImplementation(async (url) =>
    url.includes('recent_hot')
      ? {
          items: [
            {
              id: '7',
              title: 'Douban movie',
              pic: { large: 'https://image.test/7.jpg' },
            },
          ],
        }
      : {
          id: '7',
          title: 'Douban movie',
          year: '2026',
          cover_url: 'https://image.test/7-wide.jpg',
        }
  );
  const result = await service.getInitialBannerData();
  expect(result.source).toBe('Douban');
  expect(result.list[0]).toMatchObject({
    id: '7',
    title: 'Douban movie',
    backdrop_path: 'https://image.test/7-wide.jpg',
  });
});

test('refreshes cached data after three hours', async () => {
  await service.getBannerData();
  jest.advanceTimersByTime(3 * 60 * 60 * 1000 - 1);
  await service.getBannerData();
  expect(getTMDBTrendingContent).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1);
  await service.getBannerData();
  expect(getTMDBTrendingContent).toHaveBeenCalledTimes(2);
});

test('keeps missing-key errors compatible with the API and omits an initial seed', async () => {
  config = { SiteConfig: { BannerDataSource: 'TMDB' } };
  const { GET } = require('../src/app/api/tmdb/trending/route');
  const response = await GET();
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    code: 400,
    message: 'TMDB API Key 未配置',
  });
  await expect(service.getInitialBannerData()).resolves.toBeNull();
});

test('keeps provider-error API payloads and permits recovery on a later request', async () => {
  config = { SiteConfig: { BannerDataSource: 'Douban' } };
  fetchDoubanData
    .mockRejectedValueOnce(new Error('upstream failed'))
    .mockResolvedValue({ items: [] });
  const { GET } = require('../src/app/api/tmdb/trending/route');
  const response = await GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    code: 500,
    list: [],
    source: 'Douban',
  });
  await expect(service.getBannerData()).resolves.toEqual({
    code: 200,
    list: [],
    source: 'Douban',
  });
});

test('the homepage seed uses the configured Douban image proxy from the same config read', async () => {
  config.SiteConfig = {
    ...config.SiteConfig,
    BannerDataSource: 'Douban',
    DoubanImageProxyType: 'server',
  };
  fetchDoubanData.mockImplementation(async (url) =>
    url.includes('recent_hot')
      ? {
          items: [{ id: '7', title: 'Douban film' }],
        }
      : {
          title: 'Douban film',
          year: '2026',
          cover_url: 'https://img9.doubanio.com/view/photo/public/film.jpg',
        }
  );
  const Home = require('../src/app/page').default;
  const result = await Home();
  const hero = Object.values(result.props.initialBannerArtwork)[0].hero;
  expect(hero.displaySrc).toBe(
    '/api/image-proxy?url=https%3A%2F%2Fimg9.doubanio.com%2Fview%2Fphoto%2Fpublic%2Ffilm.jpg'
  );
  expect(getConfig).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(result.props)).not.toContain('server-secret');
});

test('TMDB seed artwork uses the exact image base from its config snapshot', async () => {
  config.SiteConfig.TMDBImageBaseUrl = 'https://site-images.example/tmdb';
  const Home = require('../src/app/page').default;
  const result = await Home();
  const hero = Object.values(result.props.initialBannerArtwork)[0].hero;
  expect(hero.originalSrc).toBe(
    'https://site-images.example/tmdb/t/p/w1280/backdrop.jpg'
  );
  expect(hero.srcSet).toContain(
    'https://site-images.example/tmdb/t/p/w780/backdrop.jpg 780w'
  );
  expect(getConfig).toHaveBeenCalledTimes(1);
});

test('movie and TV artwork with the same provider ID remain distinct', () => {
  const {
    createInitialBannerArtwork,
  } = require('../src/lib/home/banner-artwork');
  const result = createInitialBannerArtwork({
    code: 200,
    source: 'TMDB',
    list: [item, { ...item, media_type: 'tv', backdrop_path: '/tv.jpg' }],
  });
  expect(Object.keys(result)).toHaveLength(2);
  expect(Object.values(result).map((entry) => entry.hero.originalSrc)).toEqual([
    'https://image.tmdb.org/t/p/w1280/backdrop.jpg',
    'https://image.tmdb.org/t/p/w1280/tv.jpg',
  ]);
});

test('keeps a basic Douban movie when its detail request fails', async () => {
  config = { SiteConfig: { BannerDataSource: 'Douban' } };
  fetchDoubanData
    .mockResolvedValueOnce({
      items: [
        {
          id: '7',
          title: 'Fallback movie',
          card_subtitle: '2026 / 中国 / 剧情 喜剧',
          pic: { large: 'https://image.test/7.jpg' },
        },
      ],
    })
    .mockRejectedValueOnce(new Error('detail unavailable'));
  const result = await service.getBannerData();
  expect(result.list[0]).toMatchObject({
    id: '7',
    title: 'Fallback movie',
    genres: ['剧情', '喜剧'],
    backdrop_path: 'https://image.test/7.jpg',
  });
});

test.each(['TMDBProxy', 'TMDBReverseProxy'])(
  'refreshes the selected provider when %s changes',
  async (field) => {
    await service.getBannerData();
    config = {
      ...config,
      SiteConfig: { ...config.SiteConfig, [field]: 'https://new-proxy.test' },
    };
    getTMDBTrendingContent.mockResolvedValue({
      code: 200,
      list: [{ ...item, title: 'Updated connection' }],
    });
    expect((await service.getBannerData()).list[0].title).toBe(
      'Updated connection'
    );
    expect(getTMDBTrendingContent).toHaveBeenCalledTimes(2);
  }
);

test('preserves TX shelf fallback, subtitles, tags and free-collection filtering', async () => {
  config = { SiteConfig: { BannerDataSource: 'TX' } };
  global.fetch = jest.fn(
    async () =>
      new Response(
        JSON.stringify({
          data: {
            CardList: [
              { type: 'pc_shelves', children_list: { list: { cards: [] } } },
              {
                type: 'pc_shelves',
                children_list: {
                  list: {
                    cards: [
                      {
                        params: {
                          title: '免费合集',
                          priority_image_url: 'https://image.test/free.jpg',
                        },
                      },
                      {
                        params: {
                          title: 'TX movie',
                          priority_sub_title: 'Featured film',
                          topic_label: '剧情|喜剧',
                          priority_image_url: 'https://image.test/tx.jpg',
                        },
                      },
                    ],
                  },
                },
              },
            ],
          },
        })
      )
  );
  const result = await service.getBannerData();
  expect(result.source).toBe('TX');
  expect(result.list).toHaveLength(1);
  expect(result.list[0]).toMatchObject({
    title: 'TX movie',
    subtitle: 'Featured film',
    tags: ['剧情', '喜剧'],
    backdrop_path: 'https://image.test/tx.jpg',
  });
});
