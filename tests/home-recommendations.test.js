const React = require('react');
const {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} = require('@testing-library/react');

// Standalone renders need the App Router boundary used by homepage navigation.
jest.mock('next/navigation', () => ({
  useRouter: () => require('next-router-mock').default,
}));

// These unrelated UI features perform their own network/storage work. Keep the
// homepage, its shelves, and the recommendation API clients real in this suite.
jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }) => children,
}));
jest.mock('@/components/SiteProvider', () => ({
  useSite: () => ({ announcement: '' }),
}));
jest.mock('@/components/BannerCarousel', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/ContinueWatching', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/FireworksCanvas', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/HttpWarningDialog', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/AIChatPanel', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/VideoCard', () => ({
  __esModule: true,
  default: ({ title }) => React.createElement('article', null, title),
}));

const Home = require('../src/components/home/HomePageClient').default;
const MODULES = [
  'hotMovies',
  'hotDuanju',
  'bangumiCalendar',
  'hotTvShows',
  'hotVarietyShows',
  'upcomingContent',
];
const originalFetch = global.fetch;
const originalResizeObserver = global.ResizeObserver;
const originalAbortTimeout = AbortSignal.timeout;
let requests;

function setUser(username, session = {}) {
  document.cookie = `auth_info=${encodeURIComponent(
    JSON.stringify({ username, role: 'user', timestamp: 100, ...session })
  )}; path=/`;
}

function enableOnly(ids) {
  localStorage.setItem(
    'homeModules',
    JSON.stringify(
      MODULES.map((id, order) => ({
        id,
        name: id,
        enabled: ids.includes(id),
        order,
      }))
    )
  );
}

function payload(url, title = '测试推荐') {
  if (url.includes('/calendar')) return [{ weekday: { en: 'Sun' }, items: [] }];
  if (url.includes('/douban/categories'))
    return {
      code: 200,
      message: '获取成功',
      list: [
        {
          id: '1',
          title,
          poster: 'https://example.test/poster.jpg',
          rate: '8',
          year: '2026',
        },
      ],
    };
  return { code: 200, data: [] };
}

async function answer(request, value, status = 200) {
  await act(async () => {
    request.resolve({ ok: status === 200, status, json: async () => value });
  });
}

async function answerAll(title = '测试推荐') {
  // Also handles the old implementation's sequentially started requests, so
  // cache-isolation tests fail on the defect rather than an unfinished setup.
  for (let index = 0; index < requests.length; index += 1) {
    const request = requests[index];
    await answer(request, payload(request.url, title));
  }
}

beforeEach(() => {
  localStorage.clear();
  requests = [];
  setUser('alice');
  localStorage.setItem('doubanDataSource', 'direct');
  localStorage.setItem('doubanDataSourceBackup', 'direct');
  localStorage.setItem('animeDataSource', 'server-proxy');
  localStorage.setItem('animeDataSourceBackup', 'server-proxy');
  enableOnly(MODULES);
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  AbortSignal.timeout = () => new AbortController().signal;
  global.fetch = jest.fn(
    (url, options) =>
      new Promise((resolve, reject) => {
        requests.push({ url: String(url), options, resolve, reject });
      })
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  localStorage.clear();
  document.cookie = 'auth_info=; path=/; max-age=0';
  global.fetch = originalFetch;
  global.ResizeObserver = originalResizeObserver;
  AbortSignal.timeout = originalAbortTimeout;
});

test('saved hidden modules make no request, including before layout settings load', () => {
  enableOnly(['hotMovies', 'upcomingContent']);
  render(React.createElement(Home));
  expect(requests.map(({ url }) => url)).toEqual([
    '/api/douban/categories?kind=movie&category=热门&type=全部&limit=20&start=0',
    '/api/tmdb/upcoming',
  ]);
});

test('all enabled modules start independently in shelf order without waiting for another API', () => {
  render(React.createElement(Home));
  expect(requests).toHaveLength(6);
  expect(requests[1].url).toBe('/api/duanju/recommends');
  expect(requests[5].url).toBe('/api/tmdb/upcoming');
});

test('a ready shelf displays while another shelf still waits', async () => {
  render(React.createElement(Home));
  await answer(
    requests.find(({ url }) => url.includes('kind=movie')),
    payload('/douban/categories', '先到的电影')
  );
  expect(
    within(screen.getByRole('region', { name: '热门电影' })).getByText(
      '先到的电影'
    )
  ).toBeInTheDocument();
  expect(
    screen
      .getByRole('region', { name: '热门剧集' })
      .querySelector('.animate-pulse')
  ).not.toBeNull();
});

test('a missing cache refreshes only that module and keeps fresh shelves visible', async () => {
  const first = render(React.createElement(Home));
  await answerAll('已缓存电影');
  first.unmount();
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key === 'homepage_movies' || key.endsWith(':hotMovies'))
      localStorage.removeItem(key);
  }
  requests = [];
  render(React.createElement(Home));
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toContain('kind=movie');
  expect(
    within(screen.getByRole('region', { name: '热门剧集' })).getByText(
      '已缓存电影'
    )
  ).toBeInTheDocument();
});

test('an empty successful recommendation is cached rather than fetched on every visit', async () => {
  enableOnly(['hotDuanju']);
  const first = render(React.createElement(Home));
  await answerAll();
  first.unmount();
  requests = [];
  render(React.createElement(Home));
  expect(requests).toHaveLength(0);
});

test('recommendation caches from a previous signed-in user are not displayed or reused', async () => {
  const first = render(React.createElement(Home));
  await answerAll('Alice 的片单');
  first.unmount();
  setUser('bob');
  requests = [];
  render(React.createElement(Home));
  await act(async () => {});
  expect(screen.queryAllByText('Alice 的片单')).toHaveLength(0);
  expect(requests.some(({ url }) => url.includes('kind=movie'))).toBe(true);
});

test('late results after unmount do not populate the homepage cache', async () => {
  const view = render(React.createElement(Home));
  view.unmount();
  await answerAll('已卸载请求的电影');
  const storedValues = Array.from({ length: localStorage.length }, (_, index) =>
    localStorage.getItem(localStorage.key(index))
  );
  expect(storedValues.some((value) => value.includes('已卸载请求的电影'))).toBe(
    false
  );
});

test('turning a module off ignores its pending response and aborts its direct request', async () => {
  enableOnly(['hotDuanju']);
  render(React.createElement(Home));
  const request = requests.find(({ url }) => url === '/api/duanju/recommends');
  expect(request).toBeDefined();
  enableOnly([]);
  fireEvent(window, new Event('homeModulesUpdated'));
  expect(request.options.signal.aborted).toBe(true);
  await answer(request, {
    code: 200,
    data: [{ id: 'hidden', title: '已关闭模块的短剧' }],
  });
  const storedValues = Array.from({ length: localStorage.length }, (_, index) =>
    localStorage.getItem(localStorage.key(index))
  );
  expect(storedValues.some((value) => value.includes('已关闭模块的短剧'))).toBe(
    false
  );
});

test('the upcoming shelf shows its own loading state before returning a sorted list', async () => {
  enableOnly(['upcomingContent']);
  render(React.createElement(Home));
  expect(
    screen
      .getByRole('region', { name: '即将上映' })
      .querySelector('.animate-pulse')
  ).not.toBeNull();
  await answer(requests[0], {
    code: 200,
    data: [
      { id: 3, media_type: 'movie', title: '未知档期', poster_path: '/c.jpg' },
      {
        id: 2,
        media_type: 'movie',
        title: '后上映',
        release_date: '2026-12-10',
        poster_path: '/b.jpg',
      },
      {
        id: 1,
        media_type: 'movie',
        title: '先上映',
        release_date: '2026-10-10',
        poster_path: '/a.jpg',
      },
    ],
  });
  const shelf = screen.getByRole('region', { name: '即将上映' });
  expect(
    within(shelf)
      .getAllByRole('article')
      .map((card) => card.textContent)
  ).toEqual(['先上映', '后上映', '未知档期']);
  expect(shelf.querySelector('.animate-pulse')).toBeNull();
});

test('invalid saved layout data falls back to working defaults', () => {
  localStorage.setItem('homeModules', JSON.stringify({ invalid: true }));
  expect(() => render(React.createElement(Home))).not.toThrow();
  expect(requests).toHaveLength(6);
});

test('a failed module does not remove a stale cached shelf or delay successful siblings', async () => {
  const first = render(React.createElement(Home));
  await answerAll('缓存可用的电影');
  first.unmount();
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key.startsWith('homepage_')) continue;
    const value = JSON.parse(localStorage.getItem(key));
    value.timestamp = 1;
    localStorage.setItem(key, JSON.stringify(value));
  }
  requests = [];
  render(React.createElement(Home));
  expect(
    within(screen.getByRole('region', { name: '热门电影' })).getByText(
      '缓存可用的电影'
    )
  ).toBeInTheDocument();
  await answer(
    requests.find(({ url }) => url.includes('kind=movie')),
    { code: 503 },
    503
  );
  await answer(
    requests.find(({ url }) => url.includes('category=tv')),
    payload('/douban/categories', '已刷新的剧集')
  );
  expect(
    within(screen.getByRole('region', { name: '热门电影' })).getByText(
      '缓存可用的电影'
    )
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole('region', { name: '热门剧集' })).getByText(
      '已刷新的剧集'
    )
  ).toBeInTheDocument();
});

test('enabling another shelf does not restart an already pending module', () => {
  enableOnly(['hotMovies']);
  render(React.createElement(Home));
  enableOnly(['hotMovies', 'hotDuanju']);
  fireEvent(window, new Event('homeModulesUpdated'));
  expect(requests).toHaveLength(2);
  expect(requests.map(({ url }) => url)).toEqual([
    '/api/douban/categories?kind=movie&category=热门&type=全部&limit=20&start=0',
    '/api/duanju/recommends',
  ]);
});

test('a response from the previous account cannot write cache after the cookie changes', async () => {
  enableOnly(['hotMovies']);
  render(React.createElement(Home));
  setUser('bob');
  await answerAll('过期账号响应');
  expect(screen.queryByText('过期账号响应')).not.toBeInTheDocument();
  const storedValues = Array.from({ length: localStorage.length }, (_, index) =>
    localStorage.getItem(localStorage.key(index))
  );
  expect(storedValues.some((value) => value.includes('过期账号响应'))).toBe(
    false
  );
});

test('access-token renewal within a login session does not discard successful recommendations', async () => {
  const session = {
    username: 'alice',
    role: 'user',
    timestamp: 100,
    refreshExpires: 99999,
  };
  document.cookie = `auth_info=${encodeURIComponent(
    JSON.stringify(session)
  )}; path=/`;
  enableOnly(['hotMovies']);
  render(React.createElement(Home));
  document.cookie = `auth_info=${encodeURIComponent(
    JSON.stringify({ ...session, timestamp: 200 })
  )}; path=/`;
  await answerAll('刷新凭证后的电影');
  expect(screen.getByText('刷新凭证后的电影')).toBeInTheDocument();
});

test('a new login of the same account does not reuse the previous session cache', async () => {
  setUser('alice', { refreshExpires: 99999 });
  enableOnly(['hotMovies']);
  const first = render(React.createElement(Home));
  await answerAll('上次登录的片单');
  first.unmount();
  setUser('alice', { refreshExpires: 199999 });
  requests = [];
  render(React.createElement(Home));
  expect(screen.queryByText('上次登录的片单')).not.toBeInTheDocument();
  expect(requests).toHaveLength(1);
});

test('unavailable saved layout storage still permits the default recommendation shelves to load', async () => {
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('Storage blocked', 'SecurityError');
  });
  jest.spyOn(console, 'error').mockImplementation(() => {});
  expect(() => render(React.createElement(Home))).not.toThrow();
  expect(requests).toHaveLength(6);
});

test.each(['direct', 'cmliussss-cdn-tencent'])(
  'disabling a Douban shelf cancels its %s request without fallback or a global error',
  async (source) => {
    enableOnly(['hotMovies']);
    localStorage.setItem('doubanDataSource', source);
    localStorage.setItem(
      'doubanDataSourceBackup',
      source === 'direct' ? 'cmliussss-cdn-tencent' : 'direct'
    );
    const errors = [];
    const onError = (event) => errors.push(event.detail.message);
    window.addEventListener('globalError', onError);
    try {
      render(React.createElement(Home));
      const primary = requests[0];
      enableOnly([]);
      fireEvent(window, new Event('homeModulesUpdated'));
      const aborted = primary.options?.signal?.aborted;
      await act(async () =>
        primary.reject(new DOMException('Cancelled', 'AbortError'))
      );
      expect(aborted).toBe(true);
      expect(requests).toHaveLength(1);
      expect(errors).toEqual([]);
    } finally {
      window.removeEventListener('globalError', onError);
    }
  }
);

test.each(['late-success', 'abort-error'])(
  'cancelling a calendar request (%s) leaves another consumer and its cache intact',
  async (outcome) => {
    enableOnly(['bangumiCalendar']);
    localStorage.setItem('animeDataSourceBackup', 'direct');
    render(React.createElement(Home));
    const { GetBangumiCalendarData } = require('../src/lib/bangumi.client');
    const otherConsumer = GetBangumiCalendarData();
    const [homeRequest, otherRequest] = requests;
    enableOnly([]);
    fireEvent(window, new Event('homeModulesUpdated'));
    const homeAborted = homeRequest.options.signal.aborted;
    const otherAborted = otherRequest.options.signal.aborted;
    await answer(otherRequest, [{ weekday: { en: 'Sun' }, items: [] }]);
    await otherConsumer;
    if (outcome === 'late-success')
      await answer(homeRequest, [{ weekday: { en: 'Old' }, items: [] }]);
    else
      await act(async () =>
        homeRequest.reject(new DOMException('Cancelled', 'AbortError'))
      );
    expect(homeAborted).toBe(true);
    expect(otherAborted).toBe(false);
    expect(requests).toHaveLength(2);
    expect(
      JSON.parse(localStorage.getItem('homepage_bangumi')).data[0].weekday.en
    ).toBe('Sun');
  }
);
