/** @jest-environment node */
require('./web-globals');
const { webcrypto } = require('crypto');
global.crypto = webcrypto;
jest.mock('../src/lib/db', () => ({
  db: { getUserInfoV2: jest.fn(), getUsernameByTvboxToken: jest.fn() },
  getStorage: jest.fn(),
}));
const { NextRequest } = require('next/server');
const { db, getStorage } = require('../src/lib/db');
const { signAuthData } = require('../src/lib/auth-signature');
const { getAuthenticatedUser } = require('../src/lib/session');
const { authResponse, setAuthCookies } = require('../src/lib/auth-response');
const {
  createMediaProxyToken,
  isMediaProxyAuthorized,
} = require('../src/lib/server/media-proxy-auth');
const { POST: refresh } = require('../src/app/api/auth/refresh/route');
const { GET: socketAuth } = require('../src/app/api/auth/socket/route');
const sessions = new Map();
const adapter = {
  hGet: jest.fn(async (key, field) => sessions.get(key + ':' + field) || null),
  hSet: jest.fn(async (key, field, value) =>
    sessions.set(key + ':' + field, value)
  ),
  hDel: jest.fn(async (key, field) => sessions.delete(key + ':' + field)),
};
let auth, credential;

beforeEach(async () => {
  process.env.PASSWORD = 'session-test-secret';
  process.env.USERNAME = 'owner';
  process.env.NEXT_PUBLIC_STORAGE_TYPE = 'd1';
  delete process.env.AUTH_SECRET;
  delete process.env.PROXY_M3U8_TOKEN;
  delete process.env.TVBOX_SUBSCRIBE_TOKEN;
  sessions.clear();
  getStorage.mockReturnValue({ adapter });
  db.getUserInfoV2.mockResolvedValue({ role: 'user', banned: false });
  auth = {
    version: 2,
    username: 'alice',
    role: 'user',
    timestamp: Date.now(),
    tokenId: 'a'.repeat(32),
    refreshToken: 'b'.repeat(64),
    refreshExpires: Date.now() + 86_400_000,
  };
  auth.signature = await signAuthData(auth);
  credential = encodeURIComponent(JSON.stringify(auth));
  sessions.set(
    'user_tokens:alice:' + auth.tokenId,
    JSON.stringify({ token: auth.refreshToken, expiresAt: auth.refreshExpires })
  );
});
function request(
  path = '/api/auth/socket',
  token = credential,
  browser = true
) {
  return new NextRequest('https://example.test' + path, {
    headers: {
      ...(token ? { cookie: 'auth=' + token } : {}),
      ...(browser ? { 'sec-fetch-site': 'same-origin' } : {}),
    },
  });
}

test('real session boundary rejects revoked devices, banned users and stale roles', async () => {
  expect((await socketAuth(request())).status).toBe(200);
  expect(db.getUserInfoV2).toHaveBeenCalledWith('alice', true);
  db.getUserInfoV2.mockResolvedValueOnce({ role: 'user', banned: true });
  expect(await getAuthenticatedUser(request())).toBeNull();
  db.getUserInfoV2.mockResolvedValueOnce({ role: 'admin', banned: false });
  expect(await getAuthenticatedUser(request())).toBeNull();
  sessions.clear();
  expect((await socketAuth(request())).status).toBe(401);
});

test('browser response exposes only metadata and HttpOnly credentials; native clients can read their token', async () => {
  const response = authResponse(request(), credential);
  setAuthCookies(response, credential, request());
  const body = await response.json();
  expect(body).not.toHaveProperty('token');
  expect(body.auth).not.toHaveProperty('signature');
  expect(body.auth).not.toHaveProperty('refreshToken');
  expect(response.cookies.get('auth')).toMatchObject({
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
  });
  expect(
    decodeURIComponent(response.cookies.get('auth_info').value)
  ).not.toContain(auth.refreshToken);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(
    await authResponse(
      request('/api/login', credential, false),
      credential
    ).json()
  ).toHaveProperty('token', credential);
});

test('expired access can refresh through persisted state, revoked refresh cannot', async () => {
  auth.timestamp -= 5 * 60 * 60 * 1000;
  auth.signature = await signAuthData(auth);
  credential = encodeURIComponent(JSON.stringify(auth));
  expect(await getAuthenticatedUser(request())).toBeNull();
  expect((await refresh(request('/api/auth/refresh'))).status).toBe(200);
  sessions.clear();
  expect((await refresh(request('/api/auth/refresh'))).status).toBe(401);
});

test('scoped proxy tokens authorize media only and stop working on revocation', async () => {
  const media = await createMediaProxyToken(auth);
  const req = request('/api/proxy-m3u8?token=' + media, null);
  expect(await isMediaProxyAuthorized(req)).toBe(true);
  expect(await getAuthenticatedUser(req)).toBeNull();
  expect(await isMediaProxyAuthorized(request('/api/proxy-m3u8', null))).toBe(
    false
  );
  expect(
    await isMediaProxyAuthorized(
      request('/api/proxy-m3u8?token=' + media.slice(0, -5) + 'aaaaa', null)
    )
  ).toBe(false);
  sessions.clear();
  expect(await isMediaProxyAuthorized(req)).toBe(false);
});

test('client-visible legacy environment token grants no access', async () => {
  process.env.NEXT_PUBLIC_PROXY_M3U8_TOKEN = 'public-value';
  expect(
    await isMediaProxyAuthorized(
      request('/api/proxy-m3u8?token=public-value', null)
    )
  ).toBe(false);
  delete process.env.NEXT_PUBLIC_PROXY_M3U8_TOKEN;
});

test('a concurrent device revocation cannot be recreated by the last-used update', async () => {
  const { verifyRefreshToken } = require('../src/lib/refresh-token');
  adapter.hCompareAndSet = jest.fn(async () => {
    sessions.clear();
    return false;
  });
  expect(
    await verifyRefreshToken(auth.username, auth.tokenId, auth.refreshToken)
  ).toBe(false);
  expect(sessions.size).toBe(0);
  delete adapter.hCompareAndSet;
});
