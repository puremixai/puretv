/** @jest-environment node */
require('./web-globals');
Object.assign(
  global,
  require('vm').runInThisContext('({DOMException,AbortController,AbortSignal})')
);
jest.mock('../src/lib/config', () => ({
  API_CONFIG: {
    search: { path: '?wd=', pagePath: '?wd={query}&pg={page}', headers: {} },
  },
  getConfig: jest.fn(async () => ({
    SiteConfig: { SearchDownstreamMaxPage: 5 },
  })),
}));
jest.mock('../src/lib/search-cache', () => ({
  getCachedSearchPage: jest.fn(async () => null),
  setCachedSearchPage: jest.fn(),
}));
jest.mock('../src/lib/server/search-control', () => ({
  ...jest.requireActual('../src/lib/server/search-control'),
  fetchSearchResponse: jest.fn(),
}));
const { searchFromApi } = require('../src/lib/downstream');
const { fetchSearchResponse } = require('../src/lib/server/search-control');
const { setCachedSearchPage } = require('../src/lib/search-cache');
beforeEach(() => jest.clearAllMocks());
test('user cancellation never creates a shared negative cache entry', async () => {
  const controller = new AbortController();
  fetchSearchResponse.mockImplementation(async () => {
    controller.abort();
    throw controller.signal.reason;
  });
  await expect(
    searchFromApi(
      { key: 'source', name: 'source', api: 'http://fixture.test/' },
      'test',
      controller.signal
    )
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(setCachedSearchPage).not.toHaveBeenCalled();
});
test('pagination uses at most two simultaneous requests and preserves successful results', async () => {
  let active = 0,
    peak = 0;
  fetchSearchResponse.mockImplementation(async (url) => {
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    const page = new URL(url).searchParams.get('pg') || '1';
    return new Response(
      JSON.stringify({
        pagecount: 10,
        list: [
          {
            vod_id: page,
            vod_name: 'test',
            vod_play_url: '第一集$http://fixture.test/a.m3u8',
          },
        ],
      })
    );
  });
  const results = await searchFromApi(
    { key: 'source', name: 'source', api: 'http://fixture.test/' },
    'test'
  );
  expect(peak).toBe(2);
  expect(fetchSearchResponse).toHaveBeenCalledTimes(5);
  expect(results.map((item) => item.id)).toEqual(['1', '2', '3', '4', '5']);
});
