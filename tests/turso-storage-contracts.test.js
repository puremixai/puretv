/** @jest-environment node */
// Exercise the Turso adapter against real local libSQL; only client transport
// construction is substituted so these tests never need a hosted database.
jest.mock('@libsql/client/http', () => ({ createClient: jest.fn() }));
jest.mock('../src/lib/notification-dispatch', () => ({
  dispatchNotificationChannels: jest.fn(),
}));
jest.mock('../src/lib/user-cache', () => ({
  userInfoCache: { get: () => null, set: jest.fn(), delete: jest.fn() },
}));
const { createClient } = require('@libsql/client');
const { TursoAdapter } = require('../src/lib/turso-adapter');
const { D1Storage } = require('../src/lib/d1.db');
const fs = require('node:fs');
const path = require('node:path');

describe('Turso adapter contract on real libSQL', () => {
  let client, adapter;
  beforeEach(async () => {
    client = createClient({ url: 'file::memory:' });
    require('@libsql/client/http').createClient.mockReturnValue(client);
    adapter = new TursoAdapter('https://unused.invalid', 'unused');
    await client.execute(
      'CREATE TABLE probe (id TEXT PRIMARY KEY, value TEXT NOT NULL)',
    );
  });
  afterEach(() => client.close());

  test.each(['first', 'all', 'run'])(
    '%s propagates database execution errors',
    async (method) => {
      await expect(
        adapter.prepare('SELECT * FROM missing_table')[method](),
      ).rejects.toThrow();
    },
  );

  test('a failed batch rolls back preceding libSQL writes', async () => {
    await expect(
      adapter.batch([
        adapter
          .prepare('INSERT INTO probe VALUES (?,?)')
          .bind('first', 'value'),
        adapter.prepare('INSERT INTO probe (id) VALUES (?)').bind('invalid'),
      ]),
    ).rejects.toThrow();
    expect(await adapter.prepare('SELECT * FROM probe').first()).toBeNull();
  });

  test('settings CAS admits one writer and errors remain distinguishable from missing records', async () => {
    await client.execute('CREATE TABLE users (username TEXT PRIMARY KEY)');
    await client.execute("INSERT INTO users VALUES ('owner')");
    await client.executeMultiple(
      fs.readFileSync(
        path.resolve('migrations/011_local_settings_sync.sql'),
        'utf8',
      ),
    );
    const storage = new D1Storage(adapter);
    await storage.schemaReady;
    const save = (payload, expectedVersion) =>
      storage.setUserLocalSettings('owner', payload, {
        expectedVersion,
        payloadMd5: payload,
        payloadSize: payload.length,
      });
    const writes = await Promise.all([save('first', 0), save('second', 0)]);
    expect(writes.filter((result) => result.ok)).toHaveLength(1);
    expect(await save('next', 1)).toMatchObject({ ok: true, version: 2 });
    expect(await save('stale', 1)).toMatchObject({ ok: false, version: 2 });
    await client.execute('DROP TABLE user_local_settings');
    await expect(storage.getUserLocalSettings('owner')).rejects.toThrow();
  });
});
