/** @jest-environment node */
require('./web-globals');
const { NextRequest } = require('next/server');
jest.mock('../src/lib/config', () => ({ getConfig: jest.fn() }));
const { getConfig } = require('../src/lib/config');
const { GET } = require('../src/app/api/server-config/route');
const originalStorageType = process.env.NEXT_PUBLIC_STORAGE_TYPE;

afterEach(() => {
  if (originalStorageType === undefined)
    delete process.env.NEXT_PUBLIC_STORAGE_TYPE;
  else process.env.NEXT_PUBLIC_STORAGE_TYPE = originalStorageType;
});

test('public configuration exposes enabled login choices without provider credentials or endpoints', async () => {
  process.env.NEXT_PUBLIC_STORAGE_TYPE = 'sqlite';
  getConfig.mockResolvedValue({
    SiteConfig: {
      SiteName: 'Test site',
      EnableOIDCLogin: false,
      EnableOIDCRegistration: false,
      OIDCProviders: [
        {
          id: 'one',
          name: 'Company',
          enabled: true,
          enableRegistration: true,
          buttonText: 'Company login',
          clientId: 'private-client-id',
          clientSecret: 'private-client-secret',
          issuer: 'https://private.example.com',
          authorizationEndpoint: 'https://private.example.com/auth',
          tokenEndpoint: 'https://private.example.com/token',
          userInfoEndpoint: 'https://private.example.com/me',
          minTrustLevel: 2,
        },
        {
          id: 'off',
          name: 'Hidden',
          enabled: false,
          enableRegistration: false,
          buttonText: 'Hidden login',
          clientSecret: 'hidden-secret',
        },
      ],
    },
  });
  const response = await GET(
    new NextRequest('http://localhost/api/server-config'),
  );
  const body = await response.json();
  expect(body.OIDCProviders).toEqual([
    {
      id: 'one',
      name: 'Company',
      buttonText: 'Company login',
      enableRegistration: true,
    },
  ]);
  expect(body.EnableOIDCLogin).toBe(true);
  expect(body.EnableOIDCRegistration).toBe(true);
  expect(JSON.stringify(body)).not.toMatch(
    /private-|private\.example|hidden-secret/,
  );
});

test('explicitly removing all providers disables public login even with enabled legacy fields', async () => {
  process.env.NEXT_PUBLIC_STORAGE_TYPE = 'sqlite';
  getConfig.mockResolvedValue({
    SiteConfig: {
      OIDCProviders: [],
      EnableOIDCLogin: true,
      EnableOIDCRegistration: true,
      OIDCClientId: 'old',
    },
  });
  const body = await (
    await GET(new NextRequest('http://localhost/api/server-config'))
  ).json();
  expect(body.OIDCProviders).toEqual([]);
  expect(body.EnableOIDCLogin).toBe(false);
  expect(body.EnableOIDCRegistration).toBe(false);
});
