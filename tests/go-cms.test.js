/** @jest-environment node */
require('./web-globals');
const { NextRequest } = require('next/server');
jest.mock('../src/lib/session', () => ({ getAuthenticatedUser: jest.fn() }));
jest.mock('../src/lib/config', () => ({
  API_CONFIG: { search: { headers: { 'User-Agent': 'test' } } },
  getAvailableApiSites: jest.fn(),
  getConfig: jest.fn(async () => ({
    SiteConfig: { DisableYellowFilter: true },
  })),
}));
jest.mock('../src/lib/server/go-worker', () => ({
  isGoWorkerEnabled: jest.fn(),
  requestWorker: jest.fn(),
}));
jest.mock('../src/lib/server/search-control', () => ({
  fetchSearchResponse: jest.fn(),
}));
const { getAuthenticatedUser } = require('../src/lib/session');
const { getAvailableApiSites } = require('../src/lib/config');
const {
  isGoWorkerEnabled,
  requestWorker,
} = require('../src/lib/server/go-worker');
const { fetchSearchResponse } = require('../src/lib/server/search-control');
const { fetchCmsResponse } = require('../src/lib/server/go-cms');
const routes = ['search', 'videos', 'categories'].map(
  (name) => require('../src/app/api/source-search/' + name + '/route').GET,
);
const request = () =>
  new NextRequest(
    'http://local/api/source-search/search?source=s&keyword=test&categoryId=1&special=1',
  );
const raw = {
  vod_id: 1,
  vod_name: 'Video',
  vod_play_from: 'm3u8',
  vod_play_url: 'Original$https://cdn/original.m3u8',
  puretv_episodes: ['https://cdn/native.m3u8'],
  puretv_episode_titles: ['Native'],
};
beforeEach(() => {
  jest.clearAllMocks();
  isGoWorkerEnabled.mockReturnValue(true);
  getAuthenticatedUser.mockResolvedValue({ username: 'alice' });
  getAvailableApiSites.mockResolvedValue([
    { key: 's', name: 'Source', api: 'https://source.test/cms' },
  ]);
  requestWorker.mockImplementation(async () =>
    Response.json({
      list: [raw],
      pagecount: 1,
      class: [{ type_id: '1', type_name: 'Movie' }],
    }),
  );
});
test('both authentication and source visibility gate all three operations', async () => {
  getAuthenticatedUser.mockResolvedValue(null);
  for (const route of routes) expect((await route(request())).status).toBe(401);
  getAuthenticatedUser.mockResolvedValue({ username: 'alice' });
  getAvailableApiSites.mockResolvedValue([]);
  for (const route of routes) expect((await route(request())).status).toBe(404);
  expect(requestWorker).not.toHaveBeenCalled();
});
test('native results used only after source policy; three explicit operations', async () => {
  const result = await routes[0](request());
  expect((await result.json()).results[0].episodes).toEqual([
    'https://cdn/native.m3u8',
  ]);
  await routes[1](request());
  await routes[2](request());
  expect(
    requestWorker.mock.calls.map((call) => JSON.parse(call[1].body).operation),
  ).toEqual(['search', 'videos', 'categories']);
  expect(getAvailableApiSites).toHaveBeenCalledWith('alice', true);
  expect(fetchSearchResponse).not.toHaveBeenCalled();
});
test('default Node mode ignores spoofed native header and extension fields', async () => {
  isGoWorkerEnabled.mockReturnValue(false);
  fetchSearchResponse.mockResolvedValue(
    Response.json({ list: [raw] }, { headers: { 'x-puretv-cms-native': '1' } }),
  );
  const result = await routes[0](request());
  expect((await result.json()).results[0].episodes).toEqual([
    'https://cdn/original.m3u8',
  ]);
  expect(requestWorker).not.toHaveBeenCalled();
});
test('native bridge validates playback shape and never retries failures locally', async () => {
  requestWorker.mockResolvedValue(
    Response.json({ list: [{ ...raw, puretv_episodes: 'bad' }] }),
  );
  await expect(fetchCmsResponse('https://cms.test/?wd=x')).rejects.toThrow(
    'playback',
  );
  requestWorker.mockRejectedValue(new Error('worker unavailable'));
  await expect(fetchCmsResponse('https://cms.test/?wd=x')).rejects.toThrow(
    'worker unavailable',
  );
  expect(fetchSearchResponse).not.toHaveBeenCalled();
});
test('bridge preserves configured extra query, operation params, and abort signal', async () => {
  const controller = new AbortController();
  await fetchCmsResponse(
    'https://cms.test/?token=a%26b&ac=videolist&wd=a%26b&pg=2',
    {
      signal: controller.signal,
      headers: {
        Cookie: 'secret',
        Authorization: 'secret',
        'User-Agent': 'test',
      },
    },
  );
  const [, init] = requestWorker.mock.calls[0];
  const body = JSON.parse(init.body);
  expect(body).toMatchObject({
    operation: 'downstream',
    query: 'a&b',
    page: '2',
    headers: { 'user-agent': 'test' },
  });
  expect(new URL(body.url).searchParams.get('token')).toBe('a&b');
  expect(init.signal).toBe(controller.signal);
});
