/** @jest-environment node */
require('./web-globals');
global.crypto = require('crypto').webcrypto;
const fs = require('fs');
const path = require('path');
const { NextRequest } = require('next/server');
const {
  unstable_doesMiddlewareMatch,
} = require('next/experimental/testing/server');
const { middleware, config } = require('../src/middleware');
const policy = require('./helpers/api-access-policy.json');
const { signAuthData } = require('../src/lib/auth-signature');
const {
  invalidateDeviceAccessToken,
} = require('../src/lib/access-token-invalidation');

const concretize = (route) =>
  route
    .replace(/\[\.\.\.[^\]]+\]/g, 'sample/file')
    .replace(/\[[^\]]+\]/g, 'sample');
const matches = (route) =>
  unstable_doesMiddlewareMatch({ config, url: 'https://site.example' + route });
function inventory(dir, prefix = '/api') {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? inventory(path.join(dir, entry.name), prefix + '/' + entry.name)
        : /^route\.(ts|js)$/.test(entry.name)
          ? [prefix]
          : [],
    );
}
beforeEach(() => {
  process.env.PASSWORD = 'access-policy-test-secret';
  process.env.USERNAME = 'owner';
  process.env.NEXT_PUBLIC_STORAGE_TYPE = 'localstorage';
  delete process.env.AUTH_SECRET;
  delete process.env.ENABLE_TV_MODE;
});

test('every API route has exactly one explicit reviewed policy; new routes cannot silently inherit an exception', () => {
  const classified = Object.values(policy).flat();
  expect(new Set(classified).size).toBe(classified.length);
  expect(classified.slice().sort()).toEqual(
    inventory(path.join(__dirname, '../src/app/api')).sort(),
  );
});

test.each(
  Object.entries(policy).flatMap(([category, routes]) =>
    routes.map((route) => [category, route]),
  ),
)('%s: actual Next matcher for %s', (category, route) => {
  expect(matches(concretize(route))).toBe(
    ['session-middleware', 'internal-worker'].includes(category),
  );
});

test.each(policy['session-middleware'])(
  'anonymous and invalid-cookie %s never reach the handler',
  async (route) => {
    const downstream = jest.fn(() => {
      throw new Error('Handler/DB/network must not execute');
    });
    for (const method of ['GET', 'POST'])
      for (const cookie of [
        undefined,
        'auth=invalid',
        'auth=' +
          encodeURIComponent(
            JSON.stringify({
              username: 'owner',
              role: 'owner',
              signature: 'forged',
              timestamp: Date.now(),
            }),
          ),
      ]) {
        const concrete = concretize(route);
        const request = new NextRequest('https://site.example' + concrete, {
          method,
          headers: cookie ? { cookie } : {},
        });
        const response = matches(concrete)
          ? await middleware(request)
          : undefined;
        if (!response || response.headers.has('x-middleware-next'))
          downstream();
        expect(response.status).toBe(401);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
      }
    expect(downstream).not.toHaveBeenCalled();
  },
);

test.each([
  '/api/login-admin',
  '/api/server-config-private',
  '/api/proxy-m3u8-admin',
  '/api/video-proxy-private',
  '/api/emby/sources-delete',
  '/api/openlist/playback',
  '/api/auth/qr-private',
  '/api/proxy/vod/unknown',
  '/api/proxy/key-private',
])('public/media matcher exceptions do not leak into %s', (path) => {
  expect(matches(path)).toBe(true);
});

test('worker bypass is exact, while normal page shells accept refreshable access but APIs reject expired/revoked access', async () => {
  const worker = await middleware(
    new NextRequest('https://site.example/api/ai-comments/worker'),
  );
  expect(worker.headers.get('x-middleware-next')).toBe('1');
  const sibling = await middleware(
    new NextRequest('https://site.example/api/ai-comments/worker/private'),
  );
  expect(sibling.status).toBe(401);
  process.env.NEXT_PUBLIC_STORAGE_TYPE = 'd1';
  const auth = {
    version: 2,
    username: 'owner',
    role: 'owner',
    timestamp: Date.now() - 5 * 60 * 60 * 1000,
    tokenId: 'c'.repeat(32),
    refreshToken: 'd'.repeat(64),
    refreshExpires: Date.now() + 86400000,
  };
  auth.signature = await signAuthData(auth);
  const headers = {
    cookie: 'auth=' + encodeURIComponent(JSON.stringify(auth)),
  };
  expect(
    (
      await middleware(
        new NextRequest('https://site.example/api/search', { headers }),
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await middleware(
        new NextRequest('https://site.example/play', { headers }),
      )
    ).headers.get('x-middleware-next'),
  ).toBe('1');
  auth.timestamp = Date.now();
  auth.signature = await signAuthData(auth);
  invalidateDeviceAccessToken(auth.username, auth.tokenId);
  expect(
    (
      await middleware(
        new NextRequest('https://site.example/api/search', {
          headers: {
            cookie: 'auth=' + encodeURIComponent(JSON.stringify(auth)),
          },
        }),
      )
    ).status,
  ).toBe(401);
});
