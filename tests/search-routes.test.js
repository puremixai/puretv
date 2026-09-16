/** @jest-environment node */
require('./web-globals');
Object.assign(
  global,
  require('vm').runInThisContext('({DOMException,AbortController,AbortSignal})')
);
jest.mock('../src/lib/session', () => ({ getAuthenticatedUser: jest.fn() }));
jest.mock('../src/lib/cache-backend', () => ({
  consumeSearchRateLimit: jest.fn(),
}));
jest.mock('../src/lib/config', () => ({
  getConfig: jest.fn(),
  getAvailableApiSites: jest.fn(),
}));
jest.mock('../src/lib/downstream', () => ({ searchFromApi: jest.fn() }));
jest.mock('../src/lib/permissions', () => ({
  hasFeaturePermission: jest.fn(),
}));
jest.mock('../src/lib/emby-token', () => ({ getProxyToken: jest.fn() }));
jest.mock('../src/lib/emby-manager', () => ({
  embyManager: { getAllClients: jest.fn() },
}));
jest.mock('../src/lib/source-script', () => ({
  listEnabledSourceScripts: jest.fn(),
}));
jest.mock('../src/lib/server/source-health', () => ({
  sourceWeightMap: jest.fn(),
}));
const { NextRequest } = require('next/server');
const { getAuthenticatedUser } = require('../src/lib/session');
const { consumeSearchRateLimit } = require('../src/lib/cache-backend');
const { getConfig, getAvailableApiSites } = require('../src/lib/config');
const { searchFromApi } = require('../src/lib/downstream');
const { hasFeaturePermission } = require('../src/lib/permissions');
const { embyManager } = require('../src/lib/emby-manager');
const { listEnabledSourceScripts } = require('../src/lib/source-script');
const { sourceWeightMap } = require('../src/lib/server/source-health');
const routes = [
  'route',
  'ws/route',
  'one/route',
  'resources/route',
  'suggestions/route',
].map((path) => require('../src/app/api/search/' + path).GET);
const request = (user = 'alice', suffix = '?q=test&resourceId=alice') =>
  new NextRequest('http://localhost/api/search' + suffix, {
    headers: { 'x-test-user': user },
  });
const privateResponse = (response) => {
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('cdn-cache-control')).toBe('no-store');
  expect(response.headers.get('vary')).toContain('Cookie');
};
beforeEach(() => {
  jest.clearAllMocks();
  getAuthenticatedUser.mockImplementation(async (req) => ({
    username: req.headers.get('x-test-user'),
  }));
  consumeSearchRateLimit.mockResolvedValue({ allowed: true, retryAfter: 60 });
  getConfig.mockResolvedValue({
    SourceConfig: [],
    SiteConfig: { DisableYellowFilter: true },
  });
  getAvailableApiSites.mockImplementation(async (username) => [
    { key: username, name: username, api: 'http://fixture.test/' },
  ]);
  searchFromApi.mockImplementation(async (site) => [
    {
      id: '1',
      source: site.key,
      title: 'test',
      episodes: ['http://fixture.test/a.m3u8'],
    },
  ]);
  hasFeaturePermission.mockResolvedValue(false);
  listEnabledSourceScripts.mockResolvedValue([]);
  sourceWeightMap.mockResolvedValue(new Map());
});
test.each(routes)(
  'all search APIs require authentication and mark errors private',
  async (GET) => {
    getAuthenticatedUser.mockResolvedValue(null);
    const response = await GET(request());
    expect(response.status).toBe(401);
    privateResponse(response);
    expect(searchFromApi).not.toHaveBeenCalled();
  }
);
test.each(routes)(
  'all search APIs preserve private headers on success',
  async (GET) => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    privateResponse(response);
    await response.text();
  }
);
test("identical queries use each account's permitted sources and never invoke denied private libraries", async () => {
  for (const user of ['alice', 'bob']) {
    const body = await (await routes[0](request(user))).json();
    expect(body.results.map((item) => item.source)).toEqual([user]);
    const resources = await (await routes[3](request(user))).json();
    expect(resources.map((item) => item.key)).toEqual([user]);
  }
  expect(embyManager.getAllClients).not.toHaveBeenCalled();
});
test('rate limiting happens before upstream work and returns Retry-After', async () => {
  consumeSearchRateLimit.mockResolvedValue({ allowed: false, retryAfter: 12 });
  const response = await routes[0](request());
  expect(response.status).toBe(429);
  privateResponse(response);
  expect(response.headers.get('retry-after')).toBe('12');
  expect(getConfig).not.toHaveBeenCalled();
  expect(searchFromApi).not.toHaveBeenCalled();
});
test('bounded local rate fallback isolates accounts when Redis is unavailable', async () => {
  consumeSearchRateLimit.mockResolvedValue(null);
  for (let i = 0; i < 20; i++)
    expect((await routes[0](request('fallback-test', '?q='))).status).toBe(200);
  expect((await routes[0](request('fallback-test'))).status).toBe(429);
  expect((await routes[0](request('another-user', '?q='))).status).toBe(200);
});
test('private headers also cover invalid arguments, no matches and storage errors', async () => {
  const invalid = await routes[2](request('alice', '?q=test'));
  expect(invalid.status).toBe(400);
  privateResponse(invalid);
  const missing = await routes[2](
    request('alice', '?q=test&resourceId=forbidden')
  );
  expect(missing.status).toBe(404);
  privateResponse(missing);
  getConfig.mockRejectedValue(new Error('database offline'));
  const unavailable = await routes[0](request());
  expect(unavailable.status).toBe(503);
  privateResponse(unavailable);
});
test('SSE completion retains the event contract including empty source lists', async () => {
  for (const sites of [[{ key: 'alice', name: 'alice' }], []]) {
    getAvailableApiSites.mockResolvedValue(sites);
    const response = await routes[1](request());
    const events = (await response.text())
      .trim()
      .split('\n\n')
      .map((line) => JSON.parse(line.slice(6)));
    expect(events[0]).toMatchObject({
      type: 'start',
      totalSources: sites.length,
    });
    expect(events[events.length - 1]).toMatchObject({
      type: 'complete',
      completedSources: sites.length,
      totalResults: sites.length,
      partial: false,
    });
  }
});
test('SSE reader cancellation propagates to active upstream work', async () => {
  let activeSignal, started;
  const running = new Promise((resolve) => {
    started = resolve;
  });
  searchFromApi.mockImplementation(
    (site, query, signal) =>
      new Promise((resolve, reject) => {
        activeSignal = signal;
        started();
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
      })
  );
  const response = await routes[1](request());
  const reader = response.body.getReader();
  await reader.read();
  await running;
  await reader.cancel();
  expect(activeSignal.aborted).toBe(true);
});
