/** @jest-environment node */

test('explicit Node admin username overrides the Windows OS account without changing other env values', () => {
  const { applyAdminUsername } = require('../scripts/load-env');
  const env = {
    USERNAME: 'windows-user',
    ADMIN_USERNAME: 'site-owner',
    PASSWORD: 'unchanged',
  };
  applyAdminUsername(env);
  expect(env).toEqual({
    USERNAME: 'site-owner',
    ADMIN_USERNAME: 'site-owner',
    PASSWORD: 'unchanged',
  });
});
const { isCronAuthorized } = require('../server/cron-auth');
const {
  isServerScriptExecutionEnabled,
  assertServerScriptExecutionEnabled,
} = require('../src/lib/server/script-policy');

afterEach(() => {
  for (const key of [
    'CRON_SECRET',
    'CRON_PASSWORD',
    'ALLOW_SERVER_SCRIPTS',
    'BUILD_TARGET',
  ])
    delete process.env[key];
});

test('cron has no public default and accepts the configured bearer credential', () => {
  delete process.env.CRON_SECRET;
  delete process.env.CRON_PASSWORD;
  expect(isCronAuthorized(null, 'mtvpls')).toBe(false);
  process.env.CRON_SECRET = 'test-only-cron';
  expect(isCronAuthorized('Bearer test-only-cron', 'run')).toBe(true);
  expect(isCronAuthorized('Bearer wrong', 'run')).toBe(false);
});

test('legacy cron path requires an explicitly configured secret', () => {
  process.env.CRON_PASSWORD = 'test-only-legacy';
  expect(isCronAuthorized(null, 'test-only-legacy')).toBe(true);
  expect(isCronAuthorized(null, 'mtvpls')).toBe(false);
});

test('server scripts are opt-in and unavailable on edge builds', () => {
  delete process.env.ALLOW_SERVER_SCRIPTS;
  expect(() => assertServerScriptExecutionEnabled()).toThrow();
  process.env.ALLOW_SERVER_SCRIPTS = 'true';
  expect(isServerScriptExecutionEnabled()).toBe(true);
  process.env.BUILD_TARGET = 'cloudflare';
  expect(isServerScriptExecutionEnabled()).toBe(false);
});
