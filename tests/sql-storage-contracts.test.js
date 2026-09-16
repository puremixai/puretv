/** @jest-environment node */
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
jest.mock('../src/lib/notification-dispatch', () => ({
  dispatchNotificationChannels: jest.fn(),
}));
jest.mock('../src/lib/user-cache', () => ({
  userInfoCache: { get: () => null, set: jest.fn(), delete: jest.fn() },
}));
const { SQLiteAdapter } = require('../src/lib/d1-adapter');
const { D1Storage } = require('../src/lib/d1.db');

describe('SQL storage contract on real SQLite', () => {
  let sqlite, adapter, storage;
  beforeEach(async () => {
    sqlite = new Database(':memory:');
    for (const migration of [
      '001_initial_schema.sql',
      '003_add_new_episodes_to_play_records.sql',
      '010_add_is_anime_to_play_records.sql',
      '011_local_settings_sync.sql',
    ]) {
      sqlite.exec(
        fs.readFileSync(path.resolve('migrations', migration), 'utf8'),
      );
    }
    sqlite
      .prepare(
        'INSERT INTO users (username,password_hash,role,created_at) VALUES (?,?,?,?)',
      )
      .run('contract-user', 'unused', 'user', 1);
    adapter = new SQLiteAdapter(sqlite);
    storage = new D1Storage(adapter);
    await storage.schemaReady;
  });
  afterEach(() => sqlite.close());

  const save = (storage, payload, expectedVersion) =>
    storage.setUserLocalSettings('contract-user', payload, {
      expectedVersion,
      payloadMd5: payload,
      payloadSize: payload.length,
    });

  test('concurrent creates and updates have one winner for each expected version', async () => {
    const created = await Promise.all([
      save(storage, 'first', 0),
      save(storage, 'second', 0),
    ]);
    expect(created.filter((result) => result.ok)).toHaveLength(1);
    expect(created.map((result) => result.version)).toEqual([1, 1]);
    const updated = await Promise.all([
      save(storage, 'third', 1),
      save(storage, 'fourth', 1),
    ]);
    expect(updated.filter((result) => result.ok)).toHaveLength(1);
    expect(updated.map((result) => result.version)).toEqual([2, 2]);
    expect(await storage.getUserLocalSettings('contract-user')).toMatchObject({
      payload: updated[0].ok ? 'third' : 'fourth',
      version: 2,
    });
  });

  test('a nonzero expected version cannot create a missing record', async () => {
    expect(await save(storage, 'stale', 8)).toEqual({
      ok: false,
      version: 0,
      updatedAt: 0,
    });
    expect(await storage.getUserLocalSettings('contract-user')).toBeNull();
  });

  test('unconditional concurrent writes increment versions without lost increments', async () => {
    const results = await Promise.all([
      save(storage, 'first'),
      save(storage, 'second'),
    ]);
    expect(results.map((result) => result.version).sort()).toEqual([1, 2]);
  });

  test.each([-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'invalid expected version %s does not write settings',
    async (expected) => {
      await expect(save(storage, 'invalid', expected)).rejects.toThrow(
        'Invalid settings version',
      );
      expect(await storage.getUserLocalSettings('contract-user')).toBeNull();
    },
  );

  test('settings reads and writes propagate storage failures', async () => {
    sqlite.exec('DROP TABLE user_local_settings');
    await expect(
      storage.getUserLocalSettings('contract-user'),
    ).rejects.toMatchObject({ code: 'SQLITE_ERROR' });
    await expect(save(storage, 'unavailable', 0)).rejects.toMatchObject({
      code: 'SQLITE_ERROR',
    });
  });

  test.each(['first', 'all', 'run'])(
    'adapter %s rejects execution errors instead of empty success',
    async (method) => {
      const statement = adapter
        .prepare('INSERT INTO users (username) VALUES (?) RETURNING username')
        .bind('invalid');
      await expect(statement[method]()).rejects.toMatchObject({
        code: 'SQLITE_CONSTRAINT_NOTNULL',
      });
    },
  );

  test('a failed SQLite batch rolls back every preceding write', async () => {
    await expect(
      adapter.batch([
        adapter
          .prepare('INSERT INTO global_config VALUES (?,?,?)')
          .bind('probe', 'value', 1),
        adapter
          .prepare('INSERT INTO users (username) VALUES (?)')
          .bind('invalid'),
      ]),
    ).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_NOTNULL' });
    expect(
      sqlite.prepare('SELECT * FROM global_config WHERE key = ?').get('probe'),
    ).toBeUndefined();
  });

  test('play records preserve fractional progress, zero update counts and upserted metadata', async () => {
    const record = {
      title: '测试影片',
      source_name: 'Demo',
      cover: '',
      year: '',
      index: 1,
      total_episodes: 2,
      play_time: 12.75,
      total_time: 90.5,
      save_time: 1700000000000,
      search_title: '',
      new_episodes: 0,
      is_anime: true,
    };
    await storage.setPlayRecord('contract-user', 'demo+1', record);
    expect(await storage.getPlayRecord('contract-user', 'demo+1')).toEqual(
      record,
    );
    const updated = {
      ...record,
      title: '已更新',
      index: 2,
      play_time: 0,
      is_anime: false,
    };
    await storage.setPlayRecord('contract-user', 'demo+1', updated);
    expect(await storage.getAllPlayRecords('contract-user')).toEqual({
      'demo+1': updated,
    });
    expect(await storage.getAllPlayRecords('another-user')).toEqual({});
  });

  test('favorites upsert metadata and deletion only removes the requested key', async () => {
    const favorite = {
      title: '收藏',
      source_name: 'Demo',
      cover: '',
      year: '2026',
      total_episodes: 3,
      save_time: 1700000000000,
      search_title: '',
      origin: 'vod',
      is_completed: true,
      vod_remarks: '全三集',
    };
    await storage.setFavorite('contract-user', 'demo+1', favorite);
    await storage.setFavorite('contract-user', 'demo+2', favorite);
    const updated = {
      ...favorite,
      is_completed: false,
      save_time: 1700000000001,
    };
    await storage.setFavorite('contract-user', 'demo+1', updated);
    expect(await storage.getFavorite('contract-user', 'demo+1')).toEqual(
      updated,
    );
    expect(await storage.getFavorite('another-user', 'demo+1')).toBeNull();
    await storage.deleteFavorite('contract-user', 'demo+2');
    expect(await storage.getAllFavorites('contract-user')).toEqual({
      'demo+1': updated,
    });
  });

  test('cleanup keeps the newest records and bulk deletion respects account ownership', async () => {
    const previousLimit = process.env.MAX_PLAY_RECORDS_PER_USER;
    process.env.MAX_PLAY_RECORDS_PER_USER = '3';
    sqlite
      .prepare(
        'INSERT INTO users (username,password_hash,role,created_at) VALUES (?,?,?,?)',
      )
      .run('second-user', 'unused', 'user', 1);
    const record = {
      title: '进度',
      source_name: 'Demo',
      index: 1,
      total_episodes: 2,
      play_time: 0,
      total_time: 90,
      save_time: 1,
    };
    try {
      await storage.setPlayRecord('second-user', 'bulk+13', record);
      await Promise.all(
        Array.from({ length: 14 }, (_, index) =>
          storage.setPlayRecord('contract-user', `bulk+${index}`, {
            ...record,
            save_time: index,
          }),
        ),
      );
      await storage.cleanupOldPlayRecords('contract-user');
      expect(
        Object.keys(await storage.getAllPlayRecords('contract-user')),
      ).toEqual(['bulk+13', 'bulk+12', 'bulk+11']);
      await storage.deletePlayRecords('contract-user', [
        'bulk+13',
        'bulk+13',
        '',
        "' OR 1=1 --",
      ]);
      expect(
        Object.keys(await storage.getAllPlayRecords('contract-user')),
      ).toEqual(['bulk+12', 'bulk+11']);
      expect(
        await storage.getPlayRecord('second-user', 'bulk+13'),
      ).not.toBeNull();
    } finally {
      if (previousLimit === undefined)
        delete process.env.MAX_PLAY_RECORDS_PER_USER;
      else process.env.MAX_PLAY_RECORDS_PER_USER = previousLimit;
    }
  });
});
