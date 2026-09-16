const { getPostgresPool } = require('./postgres');
const { cacheHealth } = require('./redis-cache');

// Readiness for the Docker/custom server deployment. Redis is optional for availability.
async function getHealth() {
  if (process.env.NEXT_PUBLIC_STORAGE_TYPE !== 'postgres')
    return { status: 'ok' };
  try {
    await getPostgresPool().query('SELECT 1');
  } catch {
    return { status: 'unavailable', database: 'unavailable' };
  }
  const cache = await cacheHealth();
  return {
    status: cache.configured && !cache.connected ? 'degraded' : 'ok',
    database: 'ok',
    cache: cache.connected
      ? 'ok'
      : cache.configured
      ? 'unavailable'
      : 'disabled',
  };
}

module.exports = { getHealth };
