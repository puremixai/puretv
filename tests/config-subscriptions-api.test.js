/** @jest-environment node */
require('./web-globals');
global.structuredClone = require('vm').runInThisContext('structuredClone');
const { NextRequest } = require('next/server');
jest.mock('../src/lib/session', () => ({ getAuthenticatedUser: jest.fn() }));
jest.mock('../src/lib/db', () => ({
  db: { saveAdminConfig: jest.fn(), deleteGlobalValue: jest.fn() },
}));
jest.mock('../src/lib/config', () => ({
  getConfig: jest.fn(),
  refineConfig: (config) => config,
  setCachedConfig: jest.fn(),
}));
jest.mock('../src/lib/server/config-subscriptions', () => ({
  refreshSubscriptions: jest.fn(),
  fetchSubscriptionContent: jest.fn(),
}));
const { getAuthenticatedUser } = require('../src/lib/session');
const { db } = require('../src/lib/db');
const { getConfig, setCachedConfig } = require('../src/lib/config');
const {
  refreshSubscriptions,
} = require('../src/lib/server/config-subscriptions');
const { POST: save } = require('../src/app/api/admin/config_file/route');
const {
  POST: pull,
} = require('../src/app/api/admin/config_subscription/fetch/route');
const sub = (ID) => ({
  ID,
  Name: ID,
  URL: `https://example.com/${ID}`,
  Enabled: true,
  AutoUpdate: true,
  LastCheck: '',
  ConfigContent: '{}',
});
const request = (body) =>
  new NextRequest('http://localhost/api/admin/config_file', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'x-config-version': '0' },
  });
let current;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.USERNAME = 'owner';
  process.env.NEXT_PUBLIC_STORAGE_TYPE = 'd1';
  getAuthenticatedUser.mockResolvedValue({ username: 'owner' });
  current = {
    ConfigFile: '{}',
    ConfigFileLocal: '{}',
    ConfigSubscriptions: [],
    SourceConfig: [],
    LiveConfig: [],
    CustomCategories: [],
  };
  getConfig.mockResolvedValue(current);
  db.saveAdminConfig.mockResolvedValue(undefined);
  refreshSubscriptions.mockImplementation(async (list) => list);
});

test.each([null, { username: 'other' }])(
  'requires owner authentication for pull and save: %j',
  async (user) => {
    getAuthenticatedUser.mockResolvedValue(user);
    expect(
      (await save(request({ configFile: '{}', subscriptions: [] }))).status
    ).toBe(401);
    expect((await pull(request({ subscriptions: [] }))).status).toBe(401);
    expect(db.saveAdminConfig).not.toHaveBeenCalled();
    expect(refreshSubscriptions).not.toHaveBeenCalled();
  }
);

test('invalid lists return 400 without changing the cached config or persisted state', async () => {
  const original = JSON.stringify(current);
  expect(
    (
      await save(
        request({ configFile: '{}', subscriptions: [sub('a'), sub('a')] })
      )
    ).status
  ).toBe(400);
  expect(
    (await pull(request({ configFile: 'null', subscriptions: [sub('a')] })))
      .status
  ).toBe(400);
  expect(JSON.stringify(current)).toBe(original);
  expect(db.saveAdminConfig).not.toHaveBeenCalled();
  expect(refreshSubscriptions).not.toHaveBeenCalled();
});

test('saves a full subscription list and refreshes the config cache only after persistence', async () => {
  const response = await save(
    request({ configFile: '{}', subscriptions: [sub('a'), sub('b')] })
  );
  expect(response.status).toBe(200);
  expect(db.saveAdminConfig.mock.calls[0][0].ConfigSubscriptions).toHaveLength(
    2
  );
  expect(setCachedConfig).toHaveBeenCalledWith(
    db.saveAdminConfig.mock.calls[0][0]
  );
  expect(current.ConfigSubscriptions).toEqual([]);
});

test('old single-subscription clients cannot overwrite a saved multi-subscription list', async () => {
  current.ConfigSubscriptions = [sub('a'), sub('b')];
  const response = await save(
    request({ configFile: '{}', subscriptionUrl: 'https://example.com/new' })
  );
  expect(response.status).toBe(409);
  expect(db.saveAdminConfig).not.toHaveBeenCalled();
});

test('a preview fetch does not persist and forwards the selected subscription ID', async () => {
  const response = await pull(
    request({ configFile: '{}', subscriptions: [sub('a'), sub('b')], id: 'b' })
  );
  expect(response.status).toBe(200);
  expect(refreshSubscriptions).toHaveBeenCalledWith([sub('a'), sub('b')], {
    id: 'b',
  });
  expect((await response.json()).subscriptions).toHaveLength(2);
  expect(db.saveAdminConfig).not.toHaveBeenCalled();
});
