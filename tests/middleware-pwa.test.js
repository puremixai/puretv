/** @jest-environment node */
require('./web-globals');
const { NextRequest } = require('next/server');
const { middleware } = require('../src/middleware');

const originalPassword = process.env.PASSWORD;

beforeEach(() => {
  process.env.PASSWORD = 'middleware-test-secret';
});

afterAll(() => {
  if (originalPassword === undefined) delete process.env.PASSWORD;
  else process.env.PASSWORD = originalPassword;
});

test.each([
  '/sw.js',
  '/push-sw.js',
  '/sw.js?version=1',
  '/push-sw.js?version=1',
  '/players/iina.png',
  '/players/nplayer.png',
  '/players/mxplayer.png',
  '/players/mpv.png',
  '/players/potplayer.png',
  '/players/vlc.png',
  '/assets/jassub/jassub-worker.js',
  '/assets/jassub/jassub-worker.wasm',
  '/assets/jassub/jassub-worker-modern.wasm',
  '/assets/jassub/default.woff2',
  '/assets/jassub/NotoSansCJK-Regular.ttc',
  '/scripts/bangumi-proxy.worker.js',
])(
  'allows anonymous public asset requests to %s without a login redirect',
  async (path) => {
    const response = await middleware(
      new NextRequest(`https://puretv.example${path}`)
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('location')).toBeNull();
  }
);

test.each(['/sw.js', '/push-sw.js'])(
  'allows %s before the first password configuration',
  async (path) => {
    delete process.env.PASSWORD;
    const response = await middleware(
      new NextRequest(`https://puretv.example${path}`)
    );
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('location')).toBeNull();
  }
);

test.each([
  '/sw.js/private',
  '/sw.js.map',
  '/push-sw.js/private',
  '/push-sw.jsx',
  '/players-private/vlc.png',
  '/assets/jassub-private/jassub-worker.js',
  '/scripts/other.js',
  '/scripts/bangumi-proxy.worker.js/private',
])('does not extend the public script exception to %s', async (path) => {
  const response = await middleware(
    new NextRequest(`https://puretv.example${path}`)
  );
  expect(response.status).toBe(307);
  const destination = new URL(response.headers.get('location'));
  expect(destination.pathname).toBe('/login');
  expect(destination.searchParams.get('redirect')).toBe(path);
});

test.each([
  ['/api/search?q=film', 'GET'],
  ['/api/admin/config', 'POST'],
  ['/api/sw.js', 'GET'],
  ['/api/push-sw.js', 'POST'],
  ['/api/players/vlc.png', 'GET'],
  ['/api/assets/jassub/jassub-worker.js', 'GET'],
])('keeps anonymous %s %s requests private', async (path, method) => {
  const response = await middleware(
    new NextRequest(`https://puretv.example${path}`, { method })
  );
  expect(response.status).toBe(401);
  expect(await response.text()).toBe('Unauthorized');
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('cdn-cache-control')).toBe('no-store');
  expect(response.headers.get('vary')).toBe('Cookie, Authorization');
  expect(response.headers.get('x-middleware-next')).toBeNull();
});
