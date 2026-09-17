/** @jest-environment node */
require('./web-globals');
const { NextRequest } = require('next/server');
jest.mock('../src/lib/session', () => ({ getAuthenticatedUser: jest.fn() }));
jest.mock('../src/lib/db', () => ({
  db: { saveAdminConfig: jest.fn(), getUserInfoV2: jest.fn() },
}));
jest.mock('../src/lib/config', () => ({ getConfig: jest.fn() }));
const { getAuthenticatedUser } = require('../src/lib/session');
const { db } = require('../src/lib/db');
const { getConfig } = require('../src/lib/config');
const { POST } = require('../src/app/api/admin/site/route');
const provider = (id) => ({
  id,
  name: id,
  enabled: true,
  enableRegistration: true,
  issuer: `https://${id}.example.com`,
  authorizationEndpoint: `https://${id}.example.com/auth`,
  tokenEndpoint: `https://${id}.example.com/token`,
  userInfoEndpoint: `https://${id}.example.com/userinfo`,
  clientId: id,
  clientSecret: 'secret',
  buttonText: '',
  minTrustLevel: 0,
});
let current;
let body;
const request = (data, version = 1) =>
  new NextRequest('http://localhost/api/admin/site', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-config-version': String(version),
    },
    body: JSON.stringify(data),
  });
beforeEach(() => {
  jest.clearAllMocks();
  process.env.USERNAME = 'owner';
  process.env.NEXT_PUBLIC_STORAGE_TYPE = 'd1';
  getAuthenticatedUser.mockResolvedValue({ username: 'owner' });
  body = {
    SiteName: 'PureTV',
    Announcement: '',
    SearchDownstreamMaxPage: 2,
    SiteInterfaceCacheTime: 100,
    DoubanProxyType: '',
    DoubanProxy: '',
    DoubanImageProxyType: '',
    DoubanImageProxy: '',
    DisableYellowFilter: false,
    FluidSearch: false,
    DanmakuApiBase: '',
    DanmakuApiToken: '',
    EnableComments: false,
  };
  current = {
    ConfigVersion: 1,
    SiteConfig: { ...body, OIDCProviders: [provider('a')] },
  };
  getConfig.mockImplementation(async () => JSON.parse(JSON.stringify(current)));
  db.saveAdminConfig.mockImplementation(async (value) => {
    current = value;
  });
});

test('persists multiple providers and retains them when another settings page omits the list', async () => {
  expect(
    (
      await POST(
        request({ ...body, OIDCProviders: [provider('a'), provider('b')] }),
      )
    ).status,
  ).toBe(200);
  expect(current.SiteConfig.OIDCProviders.map((p) => p.id)).toEqual(['a', 'b']);
  expect((await POST(request(body))).status).toBe(200);
  expect(current.SiteConfig.OIDCProviders.map((p) => p.id)).toEqual(['a', 'b']);
});

test('invalid providers do not change existing configuration', async () => {
  const original = JSON.stringify(current);
  expect(
    (
      await POST(
        request({ ...body, OIDCProviders: [provider('a'), provider('a')] }),
      )
    ).status,
  ).toBe(400);
  expect(JSON.stringify(current)).toBe(original);
  expect(db.saveAdminConfig).not.toHaveBeenCalled();
});

test('saving an empty list removes all OIDC login providers', async () => {
  expect((await POST(request({ ...body, OIDCProviders: [] }))).status).toBe(
    200,
  );
  expect(current.SiteConfig.OIDCProviders).toEqual([]);
});

test('rejects identity source replacement on the same provider ID', async () => {
  expect(
    (
      await POST(
        request({
          ...body,
          OIDCProviders: [
            {
              ...provider('a'),
              userInfoEndpoint: 'https://other.example.com/userinfo',
            },
          ],
        }),
      )
    ).status,
  ).toBe(400);
  expect(current.SiteConfig.OIDCProviders[0].userInfoEndpoint).toBe(
    'https://a.example.com/userinfo',
  );
});

test('unauthenticated and stale writes cannot replace the provider list', async () => {
  expect((await POST(request({ ...body, OIDCProviders: [] }, 0))).status).toBe(
    409,
  );
  getAuthenticatedUser.mockResolvedValue(null);
  expect((await POST(request({ ...body, OIDCProviders: [] }))).status).toBe(
    401,
  );
  expect(db.saveAdminConfig).not.toHaveBeenCalled();
});

test('legacy flat updates are migrated and cannot bypass identity source validation', async () => {
  current.SiteConfig = {
    ...body,
    EnableOIDCLogin: true,
    OIDCIssuer: 'https://old.example.com',
    OIDCAuthorizationEndpoint: 'https://old.example.com/auth',
    OIDCTokenEndpoint: 'https://old.example.com/token',
    OIDCUserInfoEndpoint: 'https://old.example.com/userinfo',
    OIDCClientId: 'old-client',
    OIDCClientSecret: 'old-secret',
  };
  expect(
    (
      await POST(
        request({
          ...current.SiteConfig,
          OIDCUserInfoEndpoint: 'https://other.example.com/userinfo',
        }),
      )
    ).status,
  ).toBe(400);
  expect(db.saveAdminConfig).not.toHaveBeenCalled();
  expect(
    (
      await POST(
        request({ ...current.SiteConfig, OIDCClientSecret: 'rotated' }),
      )
    ).status,
  ).toBe(200);
  expect(current.SiteConfig.OIDCProviders).toHaveLength(1);
  expect(current.SiteConfig.OIDCProviders[0]).toMatchObject({
    id: 'legacy',
    clientSecret: 'rotated',
    userInfoEndpoint: 'https://old.example.com/userinfo',
  });
});
