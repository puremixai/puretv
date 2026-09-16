/** @jest-environment node */
require('./web-globals');
const { NextRequest } = require('next/server');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
jest.mock('../src/lib/session', () => ({ getAuthenticatedUser: jest.fn() }));
let routes, dynamic, auth, root;
const originalFetch = global.fetch;
beforeEach(() => {
  jest.resetModules();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'puretv-local-files-'));
  jest.replaceProperty(process, 'env', {
    NODE_ENV: 'test',
    NEXT_PUBLIC_ENABLE_OFFLINE_DOWNLOAD: 'true',
    OFFLINE_DOWNLOAD_DIR: root,
    PURETV_GO_LOCAL_FILES: 'true',
    PURETV_GO_URL: 'http://worker:8081',
    PURETV_GO_TOKEN: 'x'.repeat(32),
  });
  auth = require('../src/lib/session').getAuthenticatedUser;
  auth.mockResolvedValue({ username: 'owner', role: 'owner' });
  routes = require('../src/app/api/offline-download/local/route');
  dynamic = require('../src/app/api/offline-download/local/[source]/[videoId]/[episodeIndex]/[...file]/route');
  global.fetch = jest.fn(
    async () =>
      new Response('234', {
        status: 206,
        headers: {
          'Content-Type': 'video/mp2t',
          'Content-Range': 'bytes 2-4/10',
          'Content-Length': '3',
          Authorization: 'secret',
          'Set-Cookie': 'secret',
        },
      }),
  );
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});
const req = (method = 'GET', signal) =>
  new NextRequest(
    'http://example/api/offline-download/local?source=s&videoId=v&episodeIndex=0&file=clip.ts',
    {
      method,
      signal,
      headers: {
        Range: 'bytes=2-4',
        Cookie: 'browser',
        Authorization: 'browser',
      },
    },
  );
const params = {
  params: Promise.resolve({
    source: 's',
    videoId: 'v',
    episodeIndex: '0',
    file: ['nested', 'clip.ts'],
  }),
};
test.each(['GET', 'HEAD'])(
  'both routes reject unauthorized %s before worker',
  async (method) => {
    auth.mockResolvedValue({ username: 'user', role: 'user' });
    expect((await routes[method](req(method))).status).toBe(403);
    expect((await dynamic[method](req(method), params)).status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  },
);
test('feature disabled denies both routes before worker', async () => {
  process.env.NEXT_PUBLIC_ENABLE_OFFLINE_DOWNLOAD = 'false';
  jest.resetModules();
  const a = require('../src/app/api/offline-download/local/route');
  const b = require('../src/app/api/offline-download/local/[source]/[videoId]/[episodeIndex]/[...file]/route');
  expect((await a.GET(req())).status).toBe(403);
  expect((await b.GET(req(), params)).status).toBe(403);
  expect(global.fetch).not.toHaveBeenCalled();
});
test('forwards range and stream but never browser credentials or worker secrets', async () => {
  const response = await routes.GET(req());
  expect(response.status).toBe(206);
  expect(await response.text()).toBe('234');
  expect(response.headers.get('content-range')).toBe('bytes 2-4/10');
  expect(response.headers.get('authorization')).toBeNull();
  expect(response.headers.get('set-cookie')).toBeNull();
  const [url, init] = global.fetch.mock.calls[0];
  expect(new URL(url).searchParams.get('format')).toBe('query');
  expect(new Headers(init.headers).get('range')).toBe('bytes=2-4');
  expect(new Headers(init.headers).get('cookie')).toBeNull();
  expect(new Headers(init.headers).get('authorization')).toBe(
    `Bearer ${'x'.repeat(32)}`,
  );
});
test('path route passes decoded nested file and HEAD has no body', async () => {
  const response = await dynamic.HEAD(req('HEAD'), params);
  expect(await response.text()).toBe('');
  const url = new URL(global.fetch.mock.calls[0][0]);
  expect(url.searchParams.get('file')).toBe('nested/clip.ts');
  expect(url.searchParams.get('format')).toBe('path');
});
test('client abort propagates into worker request', async () => {
  const controller = new AbortController();
  await routes.GET(req('GET', controller.signal));
  const signal = global.fetch.mock.calls[0][1].signal;
  controller.abort();
  expect(signal.aborted).toBe(true);
});
test('response body cancellation cancels worker stream', async () => {
  const cancel = jest.fn();
  global.fetch.mockResolvedValue(new Response(new ReadableStream({ cancel })));
  const response = await routes.GET(req());
  await response.body.cancel();
  expect(cancel).toHaveBeenCalled();
});
test('unreachable Go returns 503 without Node fallback; default off still reads Node', async () => {
  const ep = path.join(root, 's', 'v', 'ep1');
  fs.mkdirSync(ep, { recursive: true });
  fs.writeFileSync(path.join(ep, 'clip.ts'), 'node-data');
  global.fetch.mockRejectedValue(new Error('worker unavailable'));
  expect((await routes.GET(req())).status).toBe(503);
  delete process.env.PURETV_GO_LOCAL_FILES;
  expect(await (await routes.GET(req())).text()).toBe('node-data');
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
