/** @jest-environment node */
require('./web-globals');
const { NextRequest } = require('next/server');
jest.mock('../src/lib/session', () => ({
  getAuthenticatedUser: jest.fn(async () => ({ username: 'owner' })),
}));
jest.mock('../src/lib/permissions', () => ({
  requireFeaturePermission: jest.fn(async () => ({ username: 'owner' })),
}));
jest.mock('../src/lib/db', () => ({
  db: { saveAdminConfig: jest.fn(async () => {}), getUserInfoV2: jest.fn() },
}));
jest.mock('../src/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('../src/lib/live', () => ({
  refreshLiveChannels: jest.fn(async () => 3),
  deleteCachedLiveChannels: jest.fn(),
}));
const { getConfig } = require('../src/lib/config');
const { db } = require('../src/lib/db');
const { GET } = require('../src/app/api/live/sources/route');
const { POST } = require('../src/app/api/admin/live/route');
let config;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.USERNAME = 'owner';
  config = { ConfigVersion: 1, LiveConfig: [] };
  getConfig.mockResolvedValue(config);
});
const request = (body) =>
  new NextRequest('https://puretv.example/api/admin/live', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-config-version': '1' },
    body: JSON.stringify(body),
  });

test('source API resolves legacy unset values without altering explicit settings or saved config', async () => {
  config.LiveConfig = [
    { key: 'legacy' },
    { key: 'full', proxyMode: 'full' },
    { key: 'list', proxyMode: 'm3u8-only' },
    { key: 'off', disabled: true },
  ];
  const response = await GET(
    new NextRequest('https://puretv.example/api/live/sources'),
  );
  expect(
    (await response.json()).data.map(({ key, proxyMode }) => [key, proxyMode]),
  ).toEqual([
    ['legacy', 'direct'],
    ['full', 'full'],
    ['list', 'm3u8-only'],
  ]);
  expect(config.LiveConfig[0].proxyMode).toBeUndefined();
  expect(db.saveAdminConfig).not.toHaveBeenCalled();
});

test.each([undefined, 'direct', 'full', 'm3u8-only'])(
  'adding a source persists the intended mode %j',
  async (proxyMode) => {
    const response = await POST(
      request({
        action: 'add',
        key: 'news',
        name: 'News',
        url: 'https://cdn.example/list.m3u',
        proxyMode,
      }),
    );
    expect(response.status).toBe(200);
    expect(db.saveAdminConfig.mock.calls[0][0].LiveConfig[0]).toMatchObject({
      key: 'news',
      proxyMode: proxyMode || 'direct',
    });
  },
);

test('editing source metadata preserves an existing explicit full proxy choice', async () => {
  config.LiveConfig = [{ key: 'news', from: 'custom', proxyMode: 'full' }];
  const response = await POST(
    request({
      action: 'edit',
      key: 'news',
      name: 'New title',
      url: 'https://cdn.example/new.m3u',
    }),
  );
  expect(response.status).toBe(200);
  expect(config.LiveConfig[0].proxyMode).toBe('full');
});
