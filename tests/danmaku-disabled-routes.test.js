/** @jest-environment node */
require('./web-globals');
const { NextRequest } = require('next/server');
jest.mock('../src/lib/config', () => ({ getConfig: jest.fn() }));
const { getConfig } = require('../src/lib/config');
const originalFetch = global.fetch;
const originalEnabled = process.env.DANMAKU_ENABLED;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.DANMAKU_ENABLED = 'false';
  global.fetch = jest.fn();
});
afterEach(() => {
  global.fetch = originalFetch;
  if (originalEnabled === undefined) delete process.env.DANMAKU_ENABLED;
  else process.env.DANMAKU_ENABLED = originalEnabled;
});
test.each([
  ['search', 'GET', '?keyword=电影'],
  ['match', 'POST', ''],
  ['episodes', 'GET', '?animeId=1'],
  ['comment', 'GET', '?episodeId=1'],
  ['comment', 'GET', '?url=https://video.example/film'],
])(
  'disabled %s %s returns empty data without contacting upstream',
  async (route, method, query) => {
    const handler = require(`../src/app/api/danmaku/${route}/route`)[method];
    const response = await handler(
      new NextRequest(`http://localhost/api/danmaku/${route}${query}`, {
        method,
        ...(method === 'POST'
          ? { body: JSON.stringify({ fileName: '电影' }) }
          : {}),
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      disabled: true,
      comments: [],
      animes: [],
      matches: [],
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(getConfig).not.toHaveBeenCalled();
  }
);
test('explicitly re-enabling the deployment permits upstream search', async () => {
  process.env.DANMAKU_ENABLED = 'true';
  getConfig.mockResolvedValue({ SiteConfig: { DanmakuSourceType: 'builtin' } });
  global.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, animes: [] }),
  });
  const { GET } = require('../src/app/api/danmaku/search/route');
  expect(
    (
      await GET(
        new NextRequest('http://localhost/api/danmaku/search?keyword=电影')
      )
    ).status
  ).toBe(200);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
