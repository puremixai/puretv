/** @jest-environment node */
require('./web-globals');
const { NextRequest, NextResponse } = require('next/server');
jest.mock('../src/lib/server/go-worker', () => ({
  isGoWorkerEnabled: jest.fn(() => true),
  requestWorker: jest.fn(),
}));
jest.mock('../src/lib/permissions', () => ({
  requireFeaturePermission: jest.fn(async () => ({ username: 'viewer' })),
}));
jest.mock('../src/lib/config', () => ({
  getConfig: jest.fn(async () => ({
    LiveConfig: [{ key: 'news', ua: 'Test Player' }],
    SiteConfig: {},
  })),
}));
jest.mock('../src/lib/danmaku/enabled', () => ({
  isDanmakuEnabled: jest.fn(() => true),
  disabledDanmakuResult: () => ({ count: 0, comments: [] }),
}));
const { requestWorker } = require('../src/lib/server/go-worker');
const { requireFeaturePermission } = require('../src/lib/permissions');
const {
  requestGoMedia,
  fetchGoMetadata,
  parseGoEpg,
} = require('../src/lib/server/go-media');
const originalFetch = global.fetch;

test('TMDB season transport retains mirror, key rotation and explicit proxy', async () => {
  const { getTVSeasons, getTVSeasonDetails } = require('../src/lib/tmdb.search');
  const season = { season_number: 1, episodes: [] };
  requestWorker.mockResolvedValueOnce(Response.json({ status: 200, body: JSON.stringify({ seasons: [{ season_number: 0 }, season] }) }));
  expect(await getTVSeasons('key1,key2', 123, 'http://proxy.example:8080', 'https://mirror.example')).toEqual({ code: 200, seasons: [season] });
  requestWorker.mockResolvedValueOnce(Response.json({ status: 200, body: JSON.stringify(season) }));
  expect((await getTVSeasonDetails('key1,key2', 123, 1)).code).toBe(200);
  const first = JSON.parse(requestWorker.mock.calls[0][1].body);
  const second = JSON.parse(requestWorker.mock.calls[1][1].body);
  expect(first.url).toContain('https://mirror.example/3/tv/123?api_key=key1');
  expect(first.proxy).toBe('http://proxy.example:8080');
  expect(second.url).toContain('/3/tv/123/season/1?api_key=key2');
  expect(global.fetch).not.toHaveBeenCalled();
});
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn(() => {
    throw new Error('unexpected Node upstream execution');
  });
});
afterEach(() => {
  global.fetch = originalFetch;
});

test('precheck validates permission and source before delegating exact signed URL and UA', async () => {
  const { GET } = require('../src/app/api/live/precheck/route');
  const raw = 'https://cdn.example/live?sig=a%2Fb%26c%2Bz';
  requestWorker.mockResolvedValue(
    Response.json({ success: true, type: 'm3u8' }),
  );
  const params = new URLSearchParams({ url: raw, 'puretv-source': 'news' });
  const request = new NextRequest(
    `https://app.example/api/live/precheck?${params}`,
  );
  expect(await (await GET(request)).json()).toEqual({
    success: true,
    type: 'm3u8',
  });
  expect(requestWorker).toHaveBeenCalledWith(
    '/v1/live/precheck',
    expect.objectContaining({
      body: JSON.stringify({ url: raw, ua: 'Test Player' }),
      signal: request.signal,
    }),
    35000,
  );
  requestWorker.mockClear();
  requireFeaturePermission.mockResolvedValueOnce(
    NextResponse.json({ error: 'denied' }, { status: 403 }),
  );
  expect((await GET(request)).status).toBe(403);
  expect(requestWorker).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('EPG keeps timezone fields and fails explicitly without Node rerun', async () => {
  const data = {
    CCTV1: [
      {
        start: '20260914120000 +0800',
        end: '20260914130000 +0800',
        title: 'News',
      },
    ],
  };
  requestWorker.mockResolvedValueOnce(Response.json(data));
  expect(
    await parseGoEpg('https://epg.example/feed.gz', 'Aptv', ['CCTV1']),
  ).toEqual(data);
  requestWorker.mockResolvedValueOnce(
    Response.json({ error: 'failure' }, { status: 502 }),
  );
  await expect(
    parseGoEpg('https://epg.example/feed.gz', 'Aptv', ['CCTV1']),
  ).rejects.toThrow('Go EPG');
  expect(global.fetch).not.toHaveBeenCalled();
});

test('metadata preserves upstream error status and passes configured proxy and UA', async () => {
  requestWorker.mockResolvedValue(
    Response.json({
      status: 429,
      statusText: 'Too Many Requests',
      body: '{"error":"limit"}',
      contentType: 'application/json',
    }),
  );
  const response = await fetchGoMetadata(
    'https://api.example/test',
    { 'User-Agent': 'PureTV' },
    'http://proxy.example:8080',
  );
  expect(response.status).toBe(429);
  expect(await response.json()).toEqual({ error: 'limit' });
  expect(JSON.parse(requestWorker.mock.calls[0][1].body)).toEqual({
    url: 'https://api.example/test',
    headers: { 'User-Agent': 'PureTV' },
    proxy: 'http://proxy.example:8080',
  });
});

test('subscription delegates only transport and keeps Base58/JSON validation', async () => {
  const {
    fetchSubscriptionContent,
  } = require('../src/lib/server/config-subscriptions');
  const content = JSON.stringify({
    api_site: { sample: { api: 'https://example.com/api', name: 'Sample' } },
  });
  const encoded = require('bs58').default.encode(
    new TextEncoder().encode(content),
  );
  requestWorker.mockResolvedValueOnce(new Response(encoded));
  expect(
    JSON.parse(await fetchSubscriptionContent('https://example.com/sub.txt')),
  ).toEqual(JSON.parse(content));
  expect(requestWorker).toHaveBeenCalledWith(
    '/v1/subscriptions/fetch',
    expect.objectContaining({
      body: JSON.stringify({ url: 'https://example.com/sub.txt' }),
    }),
    25000,
  );
  requestWorker.mockResolvedValueOnce(new Response('invalid!'));
  await expect(
    fetchSubscriptionContent('https://example.com/sub.txt'),
  ).rejects.toThrow('JSON 或 Base58');
});

test('danmaku disabled gate avoids worker; enabled execution preserves output', async () => {
  const { GET } = require('../src/app/api/danmaku/comment/route');
  const { isDanmakuEnabled } = require('../src/lib/danmaku/enabled');
  const request = new NextRequest(
    'https://app.example/api/danmaku/comment?episodeId=123',
  );
  isDanmakuEnabled.mockReturnValueOnce(false);
  expect(await (await GET(request)).json()).toEqual({ count: 0, comments: [] });
  expect(requestWorker).not.toHaveBeenCalled();
  const result = { count: 1, comments: [{ p: '1,2', m: 'hello', cid: 0 }] };
  requestWorker.mockResolvedValueOnce(Response.json(result));
  expect(await (await GET(request)).json()).toEqual(result);
  expect(requestWorker).toHaveBeenCalledWith(
    '/v1/danmaku/comment',
    expect.objectContaining({ signal: request.signal }),
    125000,
  );
});

test('bridge propagates transport failure and cancellation signal', async () => {
  requestWorker.mockRejectedValueOnce(new Error('cancelled'));
  const controller = new AbortController();
  controller.abort();
  await expect(
    requestGoMedia(
      '/v1/live/precheck',
      { url: 'https://example.com' },
      controller.signal,
    ),
  ).rejects.toThrow('cancelled');
  expect(global.fetch).not.toHaveBeenCalled();
});
