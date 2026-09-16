/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const { randomUUID, createHash, webcrypto } = require('crypto');
global.crypto = webcrypto;
jest.mock('../src/lib/user-cache', () => ({
  userInfoCache: { get: () => null, set: jest.fn(), delete: jest.fn() },
}));
jest.mock('../src/lib/notification-dispatch', () => ({
  dispatchNotificationChannels: jest.fn(),
}));
const Database = require('better-sqlite3');
const { SQLiteAdapter } = require('../src/lib/d1-adapter');
const { D1Storage } = require('../src/lib/d1.db');
const { initSQLiteDatabase } = require('../scripts/init-sqlite');
const { verifyPassword } = require('../src/lib/password');
const dbPath = path.resolve('.data', `test-${randomUUID()}.db`);
let sqlite, storage;
beforeAll(() => {
  process.env.PASSWORD = 'sqlite-test-password';
  process.env.USERNAME = 'test-owner';
  process.env.SQLITE_DB_PATH = dbPath;
  const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    initSQLiteDatabase();
  } finally {
    log.mockRestore();
  }
  sqlite = new Database(dbPath);
  storage = new D1Storage(new SQLiteAdapter(sqlite));
});
afterAll(async () => {
  if (storage) await storage.schemaReady;
  sqlite?.close();
  for (const suffix of ['', '-shm', '-wal'])
    fs.rmSync(dbPath + suffix, { force: true });
  delete process.env.SQLITE_DB_PATH;
});

test('real migrations create a usable salted administrator password', async () => {
  const row = sqlite
    .prepare('SELECT password_hash FROM users WHERE username = ?')
    .get('test-owner');
  expect(row.password_hash).toMatch(/^pbkdf2-sha256\$600000\$/);
  expect(
    (await verifyPassword('sqlite-test-password', row.password_hash)).valid
  ).toBe(true);
});

test('successful legacy login upgrades the hash, wrong password and banned users do not', async () => {
  await storage.createUserV2('legacy-user', 'old-password', 'user');
  const oldHash = createHash('sha256').update('old-password').digest('hex');
  sqlite
    .prepare('UPDATE users SET password_hash = ? WHERE username = ?')
    .run(oldHash, 'legacy-user');
  expect(await storage.verifyUserV2('legacy-user', 'wrong')).toBe(false);
  expect(
    sqlite
      .prepare('SELECT password_hash FROM users WHERE username = ?')
      .get('legacy-user').password_hash
  ).toBe(oldHash);
  expect(await storage.verifyUserV2('legacy-user', 'old-password')).toBe(true);
  expect(
    sqlite
      .prepare('SELECT password_hash FROM users WHERE username = ?')
      .get('legacy-user').password_hash
  ).toMatch(/^pbkdf2-sha256\$/);
  sqlite
    .prepare('UPDATE users SET banned = 1 WHERE username = ?')
    .run('legacy-user');
  expect(await storage.verifyUserV2('legacy-user', 'old-password')).toBe(false);
  expect(await storage.getUserInfoV2('legacy-user', true)).toMatchObject({
    banned: true,
  });
});

test('session records persist and disappear through the SQL hash adapter', async () => {
  await storage.adapter.hSet(
    'user_tokens:legacy-user',
    'device',
    JSON.stringify({ token: 'opaque', expiresAt: Date.now() + 1000 })
  );
  expect(
    await storage.adapter.hGet('user_tokens:legacy-user', 'device')
  ).toContain('opaque');
  await storage.adapter.hDel('user_tokens:legacy-user', 'device');
  expect(
    await storage.adapter.hGet('user_tokens:legacy-user', 'device')
  ).toBeNull();
  expect(
    await storage.adapter.hCompareAndSet(
      'user_tokens:legacy-user',
      'device',
      'old',
      'new'
    )
  ).toBe(false);
  expect(
    await storage.adapter.hGet('user_tokens:legacy-user', 'device')
  ).toBeNull();
});


test('SQLite config CAS admits one writer and preserves the winning revision', async () => {
  await storage.setAdminConfig({ ConfigVersion: 0, marker: 'legacy' });
  const results = await Promise.all([
    storage.compareAndSetAdminConfig(0, { ConfigVersion: 1, marker: 'one' }),
    storage.compareAndSetAdminConfig(0, { ConfigVersion: 1, marker: 'two' }),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect((await storage.getAdminConfig()).ConfigVersion).toBe(1);
  expect(await storage.compareAndSetAdminConfig(0, { ConfigVersion: 1, marker: 'stale' })).toBe(false);
  expect(await storage.compareAndSetAdminConfig(1, { ConfigVersion: 2, marker: 'next' })).toBe(true);
  expect((await storage.getAdminConfig()).marker).toBe('next');
});
