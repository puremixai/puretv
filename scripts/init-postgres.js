const fs = require('node:fs');
const path = require('node:path');
const { getPostgresPool, closePostgresPool } = require('../server/postgres');
const { hashPassword } = require('./password-hash');

async function initPostgresDatabase({
  seedOwner = true,
  pool = getPostgresPool(),
} = {}) {
  const client = await pool.connect();
  try {
    // Serialize schema changes across instances; record each file in the same transaction.
    await client.query(
      "SELECT pg_advisory_lock(hashtext('puretv:schema'))"
    );
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at BIGINT NOT NULL)'
    );
    const migrationsDir = path.join(__dirname, '../migrations/postgres');
    for (const filename of fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      if (
        (
          await client.query(
            'SELECT 1 FROM schema_migrations WHERE filename=$1',
            [filename]
          )
        ).rowCount
      )
        continue;
      await client.query('BEGIN');
      try {
        await client.query(
          fs.readFileSync(path.join(migrationsDir, filename), 'utf8')
        );
        await client.query('INSERT INTO schema_migrations VALUES ($1, $2)', [
          filename,
          Date.now(),
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    if (seedOwner) {
      const username =
        process.env.ADMIN_USERNAME || process.env.USERNAME || 'admin';
      const exists = await client.query(
        'SELECT 1 FROM users WHERE username=$1',
        [username]
      );
      if (!exists.rowCount) {
        if (!process.env.PASSWORD)
          throw new Error('PASSWORD is required to create the owner');
        await client.query(
          "INSERT INTO users (username,password_hash,role,created_at,playrecord_migrated,favorite_migrated,skip_migrated) VALUES ($1,$2,'owner',$3,1,1,1) ON CONFLICT (username) DO NOTHING",
          [username, hashPassword(process.env.PASSWORD), Date.now()]
        );
      }
    }
    console.log('PostgreSQL schema ready.');
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtext('puretv:schema'))")
      .finally(() => client.release());
  }
}

module.exports = { initPostgresDatabase };
if (require.main === module) {
  require('./load-env').loadAppEnv();
  initPostgresDatabase()
    .catch((error) => {
      console.error(
        'PostgreSQL initialization failed:',
        error.code || error.message
      );
      process.exitCode = 1;
    })
    .finally(closePostgresPool);
}
