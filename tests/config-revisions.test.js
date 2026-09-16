/** @jest-environment node */
require('./web-globals');
const { nextConfig, publicConfig, ConfigConflictError } = require('../src/lib/config-revisions');
const { NextRequest } = require('next/server');
const { checkMutationVersion, recordConfigConflict, withConfigMutation } = require('../src/lib/server/config-mutation');
test('history and revision advance together; stale copies cannot overwrite a newer snapshot', () => {
  const original = { ConfigVersion: 0, SiteConfig: { SiteName: 'old' } };
  const stored = nextConfig(original, { ...original, SiteConfig: { SiteName: 'new' } });
  expect(stored.ConfigVersion).toBe(1);
  expect(stored._history[0].config.SiteConfig.SiteName).toBe('old');
  expect(publicConfig(stored)._history).toBeUndefined();
  expect(() => nextConfig(stored, original)).toThrow(ConfigConflictError);
  expect(original.SiteConfig.SiteName).toBe('old');
});
test('rollback is a new revision and history is bounded without nested snapshots', () => {
  let current = null;
  for (let i = 0; i < 25; i++) current = nextConfig(current, { ConfigVersion: current?.ConfigVersion || 0, SiteConfig: { SiteName: String(i) } });
  expect(current._history).toHaveLength(20);
  const restored = nextConfig(current, { ...current._history[5].config, ConfigVersion: current.ConfigVersion });
  expect(restored.ConfigVersion).toBe(26);
  expect(restored._history[0].config.SiteConfig.SiteName).toBe('24');
  expect(restored._history.every(entry => !entry.config._history)).toBe(true);
});
test.each([[undefined, 428], ['old', 428], ['2', 409], ['3', 200]])('request version %s returns %s even through legacy error handlers', async (version, status) => {
  const handler = withConfigMutation(async () => {
    try { checkMutationVersion(3); return new Response('{}'); }
    catch (error) { recordConfigConflict(error); return new Response('{}', { status: 500 }); }
  });
  const headers = version === undefined ? {} : { 'x-config-version': version };
  expect((await handler(new NextRequest('http://localhost/api/admin/config', { headers }))).status).toBe(status);
});
