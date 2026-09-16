const { Pool, types } = require('pg');

// Shared by Next route bundles, the custom server and database tools.
const poolKey = Symbol.for('puretv.postgres.pool');
function getPostgresPool() {
  if (!globalThis[poolKey]) {
    const connectionString =
      process.env.POSTGRES_URL || process.env.DATABASE_URL;
    if (!connectionString)
      throw new Error('POSTGRES_URL or DATABASE_URL is required');
    const max = Number(process.env.POSTGRES_POOL_MAX || 10);
    if (!Number.isInteger(max) || max < 1 || max > 100)
      throw new Error('POSTGRES_POOL_MAX must be between 1 and 100');
    const pool = new Pool({
      connectionString,
      max,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 30000,
      statement_timeout: 30000,
      application_name: 'puretv',
      types: {
        getTypeParser(oid, format) {
          if (oid === 20 && format !== 'binary')
            return (value) => {
              const number = Number(value);
              return Number.isSafeInteger(number) ? number : value;
            };
          return types.getTypeParser(oid, format);
        },
      },
    });
    pool.on('error', (error) =>
      console.error(
        'PostgreSQL idle connection error:',
        error.code || error.name
      )
    );
    globalThis[poolKey] = pool;
  }
  return globalThis[poolKey];
}

async function closePostgresPool() {
  const pool = globalThis[poolKey];
  delete globalThis[poolKey];
  if (pool) await pool.end();
}

module.exports = { getPostgresPool, closePostgresPool };
