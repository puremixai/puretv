/** @jest-environment node */
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, webcrypto } = require('node:crypto');
global.crypto = webcrypto;
jest.mock('../src/lib/user-cache', () => ({
  userInfoCache: { get: () => null, set: jest.fn(), delete: jest.fn() },
}));
jest.mock('../src/lib/notification-dispatch', () => ({
  dispatchNotificationChannels: jest.fn(),
}));
const {
  PostgresAdapter,
  postgresParameters,
} = require('../src/lib/postgres-adapter');
const { PostgresStorage } = require('../src/lib/postgres.db');
const { getPostgresPool, closePostgresPool } = require('../server/postgres');
const {
  migrateSqliteToPostgres,
} = require('../scripts/migrate-sqlite-to-postgres.cjs');
const { initSQLiteDatabase } = require('../scripts/init-sqlite');
const Database = require('better-sqlite3');
const { nextConfig } = require('../src/lib/config-revisions');
const {
  getCachedSearchPage,
  setCachedSearchPage,
} = require('../src/lib/search-cache');
const { cacheHealth, closeCache } = require('../server/redis-cache');
const { getHealth } = require('../server/health');
const { createAICommentsStore } = require('../server/ai-comments-store');

test('PostgreSQL placeholder conversion preserves quoted question marks and native placeholders', () => {
  expect(postgresParameters("SELECT '?' AS literal, ? AS value -- ?\n")).toBe(
    "SELECT '?' AS literal, $1 AS value -- ?\n"
  );
  expect(postgresParameters('SELECT $1::text')).toBe('SELECT $1::text');
});

const integration = process.env.PG_TEST_URL ? describe : describe.skip;
integration('real PostgreSQL and Redis', () => {
  let pool, storage, adapter, sourcePath;
  beforeAll(async () => {
    process.env.POSTGRES_URL = process.env.PG_TEST_URL;
    process.env.ADMIN_USERNAME = 'pg-test-owner';
    process.env.USERNAME = 'pg-test-owner';
    process.env.PASSWORD = 'pg-integration-password';
    sourcePath = path.resolve('.data', `postgres-migration-${randomUUID()}.db`);
    process.env.SQLITE_DB_PATH = sourcePath;
    initSQLiteDatabase();
    const source = new Database(sourcePath);
    source
      .prepare(
        'INSERT INTO play_records (username,key,title,source_name,episode_index,total_episodes,play_time,total_time,save_time) VALUES (?,?,?,?,?,?,?,?,?)'
      )
      .run(
        'pg-test-owner',
        'demo+1',
        '迁移测试',
        'Demo',
        1,
        2,
        12.75,
        90.5,
        Date.now()
      );
    source
      .prepare(
        'INSERT INTO global_config (key,value,updated_at) VALUES (?,?,?)'
      )
      .run(
        'user_tokens:pg-test-owner:device',
        JSON.stringify({ token: 'test-only', expiresAt: Date.now() + 60000 }),
        Date.now()
      );
    source
      .prepare(
        'INSERT INTO search_history (id,username,keyword,timestamp) VALUES (?,?,?,?)'
      )
      .run(42, 'pg-test-owner', 'test', Date.now());
    source.close();
    pool = getPostgresPool();
    const report = await migrateSqliteToPostgres(sourcePath, { pool });
    expect(report.length).toBeGreaterThan(20);
    expect(report.every((item) => item.verified)).toBe(true);
    adapter = new PostgresAdapter(pool);
    storage = new PostgresStorage(adapter);
    await storage.schemaReady;
  }, 30000);
  afterAll(async () => {
    await closeCache();
    await closePostgresPool();
    for (const suffix of ['', '-wal', '-shm'])
      if (sourcePath) fs.rmSync(sourcePath + suffix, { force: true });
    delete process.env.SQLITE_DB_PATH;
  });

  test('migration verifies all rows and refuses to overwrite an occupied database', async () => {
    await expect(
      migrateSqliteToPostgres(sourcePath, { pool, verifyOnly: true })
    ).resolves.toHaveLength(23);
    await expect(migrateSqliteToPostgres(sourcePath, { pool })).rejects.toThrow(
      'Destination is not empty'
    );
    const serial = await pool.query(
      "INSERT INTO search_history (username,keyword,timestamp) VALUES ('pg-test-owner','next',1) RETURNING id"
    );
    expect(serial.rows[0].id).toBe(43);
  });

  test('migrated passwords, sessions, numeric timestamps and fractional progress remain usable', async () => {
    expect(
      await storage.verifyUserV2('pg-test-owner', 'pg-integration-password')
    ).toBe(true);
    expect(await storage.verifyUserV2('pg-test-owner', 'wrong')).toBe(false);
    expect((await storage.getUserListV2()).total).toBe(1);
    const record = await storage.getPlayRecord('pg-test-owner', 'demo+1');
    expect(record.play_time).toBe(12.75);
    expect(record.total_time).toBe(90.5);
    expect(typeof record.save_time).toBe('number');
    expect(
      await storage.adapter.hGet('user_tokens:pg-test-owner', 'device')
    ).toContain('test-only');
    expect(
      await storage.adapter.hCompareAndSet(
        'user_tokens:pg-test-owner',
        'missing',
        'old',
        'new'
      )
    ).toBe(false);
  });

  test('a failed batch rolls back preceding writes and releases its connection', async () => {
    await expect(
      adapter.batch([
        adapter
          .prepare('INSERT INTO global_config VALUES (?,?,?)')
          .bind('rollback-probe', 'value', 1),
        adapter
          .prepare('INSERT INTO users (username) VALUES (?)')
          .bind('invalid'),
      ])
    ).rejects.toThrow();
    expect(await storage.getGlobalValue('rollback-probe')).toBeNull();
    expect((await pool.query('SELECT 1 AS value')).rows[0].value).toBe(1);
    await expect(
      adapter.prepare('SELECT * FROM missing_table').first()
    ).rejects.toThrow();
  });

  test('shared SQL media repositories preserve progress, flags, metadata and scoped deletion', async () => {
    const user = 'pg-test-owner';
    const key = 'shared-sql+1';
    const record = {
      title: '共享仓储', source_name: 'Demo', cover: '', year: '', index: 1,
      total_episodes: 2, play_time: 12.75, total_time: 90.5,
      save_time: 1700000000000, search_title: '', new_episodes: 0, is_anime: true,
    };
    const favorite = {
      title: '收藏', source_name: 'Demo', cover: '', year: '2026', total_episodes: 3,
      save_time: 1700000000000, search_title: '', origin: 'vod',
      is_completed: true, vod_remarks: '全三集',
    };
    try {
      await storage.setPlayRecord(user, key, record);
      expect(await storage.getPlayRecord(user, key)).toEqual(record);
      await storage.setPlayRecord(user, key, { ...record, play_time: 0, is_anime: false });
      expect((await storage.getAllPlayRecords(user))[key]).toEqual({ ...record, play_time: 0, is_anime: false });
      expect(await storage.getPlayRecord('another-user', key)).toBeNull();
      await storage.setFavorite(user, key, favorite);
      await storage.setFavorite(user, key, { ...favorite, is_completed: false });
      expect((await storage.getAllFavorites(user))[key]).toEqual({ ...favorite, is_completed: false });
      expect(await storage.getFavorite('another-user', key)).toBeNull();
      await storage.deletePlayRecords(user, [key, key, '']);
      await storage.deleteFavorite(user, key);
      expect(await storage.getPlayRecord(user, key)).toBeNull();
      expect(await storage.getFavorite(user, key)).toBeNull();
    } finally {
      await storage.deletePlayRecord(user, key);
      await storage.deleteFavorite(user, key);
    }
  });

  test('configuration CAS has one winner, retains history and can restore as a new revision', async () => {
    const initial = { ConfigVersion: 0, SiteConfig: { SiteName: 'before' } };
    await storage.setAdminConfig(initial);
    const first = nextConfig(initial, {
      ...initial,
      SiteConfig: { SiteName: 'one' },
    });
    const second = nextConfig(initial, {
      ...initial,
      SiteConfig: { SiteName: 'two' },
    });
    const result = await Promise.all([
      storage.compareAndSetAdminConfig(0, first),
      storage.compareAndSetAdminConfig(0, second),
    ]);
    expect(result.filter(Boolean)).toHaveLength(1);
    const current = await storage.getAdminConfig();
    expect(current._history[0].config.SiteConfig.SiteName).toBe('before');
    expect(await storage.compareAndSetAdminConfig(0, first)).toBe(false);
    const restored = nextConfig(current, {
      ...current._history[0].config,
      ConfigVersion: current.ConfigVersion,
    });
    expect(await storage.compareAndSetAdminConfig(1, restored)).toBe(true);
    expect((await storage.getAdminConfig()).SiteConfig.SiteName).toBe('before');
  });

  test('concurrent comment submissions and workers produce one durable result', async () => {
    const jobs = createAICommentsStore(pool);
    const movie = { name: '持久化测试影片', year: '2024', info: '', count: 10 };
    const submitted = await Promise.all([
      jobs.enqueue('pg-test-owner', 'jobs-test-main', movie),
      jobs.enqueue('pg-test-owner', 'jobs-test-main', movie),
    ]);
    expect(submitted[0].id).toBe(submitted[1].id);
    const claimed = (await Promise.all([jobs.claim(), jobs.claim()])).filter(
      Boolean
    );
    expect(claimed).toHaveLength(1);
    const comments = [
      { id: 'saved-1', content: '已保存', isAiGenerated: true },
    ];
    const result = await jobs.complete(
      claimed[0].id,
      claimed[0].lease_token,
      comments,
      { model: 'test', protocol: 'openai-completions' }
    );
    expect(result.status).toBe('completed');
    expect(result.result_revision).toBe(1);
    expect((await jobs.get('jobs-test-main')).id).toBe(result.id);
    expect(
      (await jobs.enqueue('pg-test-owner', 'jobs-test-main', movie)).status
    ).toBe('completed');
    expect(await jobs.claim()).toBeNull();
    const script =
      "const {createAICommentsStore}=require('./server/ai-comments-store');const {closePostgresPool}=require('./server/postgres');(async()=>{const s=createAICommentsStore();const j=await s.get('jobs-test-main');console.log(JSON.stringify(await s.getResult(j.id,j.result_revision)));await closePostgresPool()})()";
    const output = require('node:child_process').execFileSync(
      process.execPath,
      ['-e', script],
      { encoding: 'utf8' }
    );
    expect(JSON.parse(output)).toEqual(comments);
  });

  test('lease recovery fences stale workers and failed regeneration preserves saved comments', async () => {
    const jobs = createAICommentsStore(pool);
    const movie = { name: '持久化测试影片', year: '2024', info: '', count: 10 };
    const previous = await jobs.get('jobs-test-main');
    const pending = await jobs.enqueue(
      'pg-test-owner',
      'jobs-test-main',
      movie,
      true
    );
    expect(pending.generation_id).not.toBe(previous.generation_id);
    expect(
      await jobs.getResult(pending.id, pending.result_revision)
    ).toHaveLength(1);
    const stale = await jobs.claim();
    await pool.query('UPDATE ai_comment_jobs SET lease_until=0 WHERE id=$1', [
      stale.id,
    ]);
    const recovered = await jobs.claim();
    expect(recovered.lease_token).not.toBe(stale.lease_token);
    expect(recovered.attempts).toBe(2);
    expect(
      await jobs.complete(
        stale.id,
        stale.lease_token,
        [{ content: 'stale' }],
        {}
      )
    ).toBeNull();
    await jobs.fail(recovered.id, recovered.lease_token, 'AI测试失败');
    const failed = await jobs.get('jobs-test-main');
    expect(failed.status).toBe('failed');
    expect(
      (await jobs.getResult(failed.id, failed.result_revision))[0].content
    ).toBe('已保存');
    await jobs.enqueue('pg-test-owner', 'jobs-test-main', movie, true);
    for (let i = 0; i < 2; i++) {
      const running = await jobs.claim();
      await pool.query('UPDATE ai_comment_jobs SET lease_until=0 WHERE id=$1', [
        running.id,
      ]);
    }
    expect(await jobs.claim()).toBeNull();
    expect((await jobs.get('jobs-test-main')).status).toBe('failed');
  });

  test('comment queue limit cannot be bypassed by simultaneous submissions', async () => {
    const jobs = createAICommentsStore(pool);
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) =>
        jobs.enqueue('pg-test-owner', 'jobs-test-limit-' + i, {
          name: '电影' + i,
          year: '',
          info: '',
          count: 10,
        })
      )
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    expect(results.find((r) => r.status === 'rejected').reason.code).toBe(
      'AI_QUEUE_FULL'
    );
    await pool.query(
      "DELETE FROM ai_comment_jobs WHERE username='pg-test-owner' AND movie_key LIKE 'jobs-test-limit-%'"
    );
  });

  test('different administrators share one movie task and can regenerate each others saved result', async () => {
    await pool.query(
      "INSERT INTO users (username,password_hash,role,created_at) VALUES ('comments-test-admin','unused','admin',$1)",
      [Date.now()]
    );
    const jobs = createAICommentsStore(pool);
    const movie = { name: '共享影评', year: '2024', info: '', count: 10 };
    const submitted = await Promise.all([
      jobs.enqueue('pg-test-owner', 'jobs-shared-admins', movie),
      jobs.enqueue('comments-test-admin', 'jobs-shared-admins', movie),
    ]);
    expect(submitted[0].id).toBe(submitted[1].id);
    const claimed = (await Promise.all([jobs.claim(), jobs.claim()])).filter(
      Boolean
    );
    expect(claimed).toHaveLength(1);
    await jobs.complete(
      claimed[0].id,
      claimed[0].lease_token,
      [{ content: '共享结果', isAiGenerated: true }],
      { model: 'mock', protocol: 'mock' }
    );
    const regenerated = await jobs.enqueue(
      'comments-test-admin',
      'jobs-shared-admins',
      movie,
      true
    );
    expect(regenerated.id).toBe(submitted[0].id);
    expect(regenerated.username).toBe('comments-test-admin');
    expect(
      (await jobs.getResult(regenerated.id, regenerated.result_revision))[0]
        .content
    ).toBe('共享结果');
    const retry = await jobs.claim();
    await jobs.fail(retry.id, retry.lease_token, 'mock failed');
    await pool.query("DELETE FROM users WHERE username='comments-test-admin'");
    const orphaned = await jobs.get('jobs-shared-admins');
    expect(orphaned.username).toBeNull();
    expect(
      (await jobs.getResult(orphaned.id, orphaned.result_revision))[0].content
    ).toBe('共享结果');
  });

  test('shared comment migration preserves legacy results and publishes the newest administrator result only', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('CREATE SCHEMA ai_comment_migration_test');
      await client.query('SET LOCAL search_path TO ai_comment_migration_test');
      await client.query(
        'CREATE TABLE users (username TEXT PRIMARY KEY, role TEXT NOT NULL)'
      );
      await client.query(
        "INSERT INTO users VALUES ('owner','owner'),('admin','admin'),('viewer','user')"
      );
      await client.query(
        fs.readFileSync(
          path.resolve('migrations/postgres/014_ai_comment_jobs.sql'),
          'utf8'
        )
      );
      for (const [id, user, key, stamp, status, revision] of [
        ['older', 'owner', 'movie', 100, 'completed', 1],
        ['latest-admin', 'admin', 'movie', 200, 'failed', 2],
        ['private', 'viewer', 'movie', 300, 'completed', 1],
        ['private-queued', 'viewer', 'queued', 300, 'queued', 0],
        ['admin-queued', 'admin', 'queued', 200, 'queued', 0],
      ]) {
        await client.query(
          `INSERT INTO ai_comment_jobs (id,username,movie_key,movie_name,requested_count,status,generation_id,comments,result_revision,generated_at,created_at,updated_at)
          VALUES ($1,$2,$3,'电影',10,$4,$1,'[{"content":"legacy"}]'::jsonb,$5,$6,$6,$6)`,
          [id, user, key, status, revision, stamp]
        );
      }
      await client.query(
        fs.readFileSync(
          path.resolve('migrations/postgres/015_shared_ai_comments.sql'),
          'utf8'
        )
      );
      expect(
        (
          await client.query(
            'SELECT id FROM ai_comment_jobs WHERE is_shared ORDER BY id'
          )
        ).rows.map((r) => r.id)
      ).toEqual(['admin-queued', 'latest-admin']);
      expect(
        (
          await client.query(
            "SELECT status FROM ai_comment_jobs WHERE id='private-queued'"
          )
        ).rows[0].status
      ).toBe('failed');
      expect(
        (await client.query('SELECT comments FROM ai_comment_jobs')).rows
      ).toHaveLength(5);
      expect(
        (
          await client.query(
            "SELECT comments FROM ai_comment_jobs WHERE id='private'"
          )
        ).rows[0].comments
      ).toEqual([{ content: 'legacy' }]);
      await client.query("DELETE FROM users WHERE username='admin'");
      expect(
        (
          await client.query(
            "SELECT username,comments FROM ai_comment_jobs WHERE id='latest-admin'"
          )
        ).rows[0]
      ).toEqual({ username: null, comments: [{ content: 'legacy' }] });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  test('Redis cache is shared across processes and cached pages cannot be mutated by callers', async () => {
    expect(await cacheHealth()).toEqual({ configured: true, connected: true });
    const source = 'integration-' + randomUUID();
    const input = [{ id: '1', title: '测试' }];
    await setCachedSearchPage(source, 'query', 1, 'ok', input, 2);
    input.push({ id: '2' });
    const first = await getCachedSearchPage(source, 'query', 1);
    expect(first.data).toHaveLength(1);
    first.data[0].title = 'changed';
    first.data.push({ id: '3' });
    expect((await getCachedSearchPage(source, 'query', 1)).data).toEqual([
      { id: '1', title: '测试' },
    ]);
    const { execFileSync } = require('node:child_process');
    const script =
      "const {createClient}=require('redis');const c=createClient({url:process.env.CACHE_REDIS_URL});(async()=>{await c.connect();console.log((await c.keys('puretv:cache:search:v2:*')).length);await c.quit()})()";
    expect(
      Number(
        execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' })
      )
    ).toBeGreaterThan(0);
  });

  test('concurrent settings creation and updates atomically enforce the expected version', async () => {
    const user = 'pg-test-owner';
    const save = (payload, expectedVersion) =>
      storage.setUserLocalSettings(user, payload, {
        expectedVersion,
        payloadMd5: payload,
        payloadSize: payload.length,
      });
    const created = await Promise.all([save('first', 0), save('second', 0)]);
    expect(created.filter((result) => result.ok)).toHaveLength(1);
    expect(created.every((result) => result.version === 1)).toBe(true);
    const updates = await Promise.all([save('third', 1), save('fourth', 1)]);
    expect(updates.filter((result) => result.ok)).toHaveLength(1);
    expect(updates.every((result) => result.version === 2)).toBe(true);
    expect((await storage.getUserLocalSettings(user)).payload).toBe(
      updates[0].ok ? 'third' : 'fourth'
    );
    const unconditional = await Promise.all([save('fifth'), save('sixth')]);
    expect(unconditional.map((result) => result.version).sort()).toEqual([
      3, 4,
    ]);
    const missing = user + '-missing';
    expect(
      await storage.setUserLocalSettings(missing, '{}', {
        expectedVersion: 8,
        payloadMd5: 'x',
        payloadSize: 2,
      })
    ).toMatchObject({ ok: false, version: 0 });
    expect(await storage.getUserLocalSettings(missing)).toBeNull();
    await pool.query('DELETE FROM user_local_settings WHERE username=$1', [
      user,
    ]);
  });

  test('Redis search budgets are atomic under concurrency and isolated by account', async () => {
    const { consumeSearchRateLimit } = require('../server/redis-cache');
    const user = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 30 }, () => consumeSearchRateLimit(user, 6))
    );
    expect(results.filter((result) => result?.allowed)).toHaveLength(20);
    expect(
      results
        .filter((result) => !result?.allowed)
        .every((result) => result.retryAfter > 0)
    ).toBe(true);
    expect((await consumeSearchRateLimit(user + '-other', 6)).allowed).toBe(
      true
    );
  });

  test('Redis loss falls back to bounded local cache without breaking PostgreSQL', async () => {
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'postgres';
    expect(await getHealth()).toEqual({
      status: 'ok',
      database: 'ok',
      cache: 'ok',
    });
    const source = 'fallback-' + randomUUID();
    await setCachedSearchPage(source, 'query', 1, 'ok', [{ id: 'fallback' }]);
    require('node:child_process').execFileSync(
      'docker',
      ['stop', process.env.TEST_REDIS_CONTAINER],
      { stdio: 'ignore' }
    );
    const started = Date.now();
    expect((await getCachedSearchPage(source, 'query', 1)).data[0].id).toBe(
      'fallback'
    );
    expect(Date.now() - started).toBeLessThan(2000);
    expect((await storage.getUserListV2()).total).toBe(1);
    expect(await getHealth()).toEqual({
      status: 'degraded',
      database: 'ok',
      cache: 'unavailable',
    });
    require('node:child_process').execFileSync(
      'docker',
      ['stop', process.env.TEST_POSTGRES_CONTAINER],
      { stdio: 'ignore' }
    );
    expect(await getHealth()).toEqual({
      status: 'unavailable',
      database: 'unavailable',
    });
  }, 15000);
});
