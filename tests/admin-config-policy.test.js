/** @jest-environment node */
require('./web-globals');
const { NextRequest } = require('next/server');
jest.mock('../src/lib/session', () => ({ getAuthenticatedUser: jest.fn() }));
jest.mock('../src/lib/db', () => ({ db: { saveAdminConfig: jest.fn(), getUserInfoV2: jest.fn(), getConfigHistory: jest.fn() } }));
jest.mock('../src/lib/config', () => ({ getConfig: jest.fn(), configSelfCheck: value => value, setCachedConfig: jest.fn() }));
const { db } = require('../src/lib/db');
const { getConfig } = require('../src/lib/config');
const { getAuthenticatedUser } = require('../src/lib/session');
const { nextConfig, publicConfig } = require('../src/lib/config-revisions');
const { checkMutationVersion } = require('../src/lib/server/config-mutation');
const { POST } = require('../src/app/api/admin/config/route');
const history = require('../src/app/api/admin/config/history/route');
let stored;
const request = (body, version = 7) => new NextRequest('http://localhost/api/admin/config', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-config-version': String(version) }, body: JSON.stringify(body) });
beforeEach(() => {
  jest.clearAllMocks(); process.env.USERNAME = 'owner'; process.env.NEXT_PUBLIC_STORAGE_TYPE = 'd1';
  stored = { ConfigVersion: 7, SiteConfig: { SiteName: 'original', AnalyticsCustomScript: 'owner script' }, UserConfig: { Users: [] }, ConfigSubscriptions: [{ ID: 'retained' }], OPDSConfig: { Enabled: false, LegadoSubscriptions: [{ id: 'kept' }] } };
  getAuthenticatedUser.mockResolvedValue({ username: 'admin' }); db.getUserInfoV2.mockResolvedValue({ role: 'admin', banned: false });
  getConfig.mockImplementation(async () => publicConfig(stored)); db.getConfigHistory.mockImplementation(async () => stored._history || []);
  db.saveAdminConfig.mockImplementation(async draft => { checkMutationVersion(stored.ConfigVersion); stored = nextConfig(stored, draft); draft.ConfigVersion = stored.ConfigVersion; });
});
test.each([{ SiteConfig: { AnalyticsCustomScript: 'evil' } }, { UserConfig: { Users: [] } }, { ConfigSubscriptions: [] }, { OPDSConfig: { Enabled: true, LegadoSubscriptions: [] } }, { ...{ SiteConfig: {} }, Unexpected: true }])('generic API rejects protected fields %j', async body => {
  expect((await POST(request(body))).status).toBe(400); expect(db.saveAdminConfig).not.toHaveBeenCalled();
});
test('authorized section update preserves independent settings and server-managed subscriptions', async () => {
  expect((await POST(request({ OPDSConfig: { Enabled: true, Sources: [] } }))).status).toBe(200);
  expect(stored.SiteConfig.AnalyticsCustomScript).toBe('owner script'); expect(stored.ConfigSubscriptions[0].ID).toBe('retained');
  expect(stored.OPDSConfig.LegadoSubscriptions[0].id).toBe('kept'); expect(stored.ConfigVersion).toBe(8);
});
test.each([{ role: 'owner', banned: false }, { role: 'admin', banned: true }, { role: 'user', banned: false }])('stored role cannot impersonate the environment owner: %j', async info => {
  db.getUserInfoV2.mockResolvedValue(info); expect((await POST(request({ LiveRefreshIntervalHours: 8 }))).status).toBe(401);
});
test('stale section update returns 409 and keeps the latest data', async () => {
  expect((await POST(request({ LiveRefreshIntervalHours: 8 }, 6))).status).toBe(409); expect(stored.ConfigVersion).toBe(7);
});
test('only owner can restore; restore keeps history and rejects stale revision', async () => {
  await POST(request({ LiveRefreshIntervalHours: 8 }));
  expect((await history.POST(request({ version: 7 }, 8))).status).toBe(403);
  getAuthenticatedUser.mockResolvedValue({ username: 'owner' });
  expect((await history.POST(request({ version: 7 }, 7))).status).toBe(409);
  expect((await history.POST(request({ version: 7 }, 8))).status).toBe(200);
  expect(stored.ConfigVersion).toBe(9); expect(stored.LiveRefreshIntervalHours).toBeUndefined();
});
