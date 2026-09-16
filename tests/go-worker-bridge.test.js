/** @jest-environment node */
require('./web-globals');
const { NextRequest } = require('next/server');
jest.mock('../src/lib/session', () => ({ getAuthenticatedUser: jest.fn() }));
jest.mock('../src/lib/offline-downloader', () => ({
  OfflineDownloader: jest.fn(() => ({ checkDownloaded: () => false })),
}));
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const originalFetch = global.fetch;
let root;
let routes;
let getAuthenticatedUser;
let OfflineDownloader;
beforeEach(() => {
  jest.resetModules();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'puretv-go-bridge-'));
  jest.replaceProperty(process, 'env', {
    NODE_ENV: 'test',
    NEXT_PUBLIC_ENABLE_OFFLINE_DOWNLOAD: 'true',
    OFFLINE_DOWNLOAD_DIR: root,
    PURETV_GO_URL: 'http://worker:8081',
    PURETV_GO_TOKEN: 's'.repeat(32),
    PURETV_GO_OFFLINE_DOWNLOADS: 'true',
  });
  ({ getAuthenticatedUser } = require('../src/lib/session'));
  ({ OfflineDownloader } = require('../src/lib/offline-downloader'));
  getAuthenticatedUser.mockResolvedValue({ username: 'owner', role: 'owner' });
  routes = require('../src/app/api/offline-download/route');
  global.fetch = jest.fn(
    async () =>
      new Response('{"tasks":[]}', {
        headers: { 'Content-Type': 'application/json' },
      }),
  );
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});
const request = (method, suffix = '', body) =>
  new NextRequest(`https://puretv.example/api/offline-download${suffix}`, {
    method,
    headers: {
      Cookie: 'auth=test-cookie',
      Authorization: 'browser-session',
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

test.each(['GET', 'POST', 'PUT', 'DELETE'])(
  'unauthorized %s never reaches Go or initializes downloads',
  async (method) => {
    getAuthenticatedUser.mockResolvedValue(null);
    const response = await routes[method](request(method));
    expect(response.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(OfflineDownloader).not.toHaveBeenCalled();
  },
);
test('default mode keeps the existing Node implementation without contacting Go', async () => {
  delete process.env.PURETV_GO_OFFLINE_DOWNLOADS;
  const response = await routes.GET(request('GET'));
  expect(await response.json()).toEqual({ tasks: [] });
  expect(OfflineDownloader).toHaveBeenCalledTimes(1);
  expect(global.fetch).not.toHaveBeenCalled();
});
test.each(['GET', 'POST', 'PUT', 'DELETE'])(
  'enabled %s preserves worker status/body and uses service authentication only',
  async (method) => {
    global.fetch.mockResolvedValue(
      new Response('{"error":"兼容错误"}', {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const body =
      method === 'POST'
        ? {
            source: 'news',
            videoId: 'a',
            episodeIndex: 0,
            title: 'Title',
            m3u8Url: 'https://cdn.example/live?sig=a%2Fb',
          }
        : undefined;
    const response = await routes[method](
      request(method, '?taskId=a%2Fb&action=retry', body),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: '兼容错误' });
    expect(OfflineDownloader).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = global.fetch.mock.calls[0];
    expect(String(url)).toBe(
      'http://worker:8081/v1/offline-download?taskId=a%2Fb&action=retry',
    );
    expect(init.method).toBe(method);
    expect(new Headers(init.headers).get('authorization')).toBe(
      `Bearer ${'s'.repeat(32)}`,
    );
    expect(new Headers(init.headers).get('cookie')).toBeNull();
    expect(init.redirect).toBe('error');
    if (body)
      expect(JSON.parse(Buffer.from(init.body).toString())).toEqual(body);
  },
);
test('worker transport failure does not start a duplicate Node job', async () => {
  global.fetch.mockRejectedValue(new Error('offline'));
  const response = await routes.POST(request('POST', '', { source: 'news' }));
  expect(response.status).toBe(503);
  expect(OfflineDownloader).not.toHaveBeenCalled();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('streaming request size is bounded before contacting Go', async () => {
  const cancelled = jest.fn();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024 + 1));
    },
    cancel: cancelled,
  });
  const response = await routes.POST(
    new NextRequest('http://puretv.test/api/offline-download', {
      method: 'POST',
      body,
      duplex: 'half',
    }),
  );
  expect(response.status).toBe(413);
  expect(cancelled).toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('slow request body times out before contacting Go', async () => {
  jest.useFakeTimers();
  try {
    const cancelled = jest.fn();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([123]));
      },
      cancel: cancelled,
    });
    const pending = routes.POST(
      new NextRequest('http://puretv.test/api/offline-download', {
        method: 'POST',
        body,
        duplex: 'half',
      }),
    );
    await jest.advanceTimersByTimeAsync(15_001);
    expect((await pending).status).toBe(408);
    expect(cancelled).toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});
