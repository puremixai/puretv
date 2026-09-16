const { createClient } = require('redis');

const stateKey = Symbol.for('puretv.redis.cache');
const state =
  globalThis[stateKey] ||
  (globalThis[stateKey] = {
    client: null,
    connecting: null,
    retryAt: 0,
    hits: 0,
    misses: 0,
    errors: 0,
    writes: 0,
  });

async function getClient() {
  if (!process.env.CACHE_REDIS_URL) return null;
  if (state.client?.isReady) return state.client;
  if (state.connecting) return state.connecting;
  if (Date.now() < state.retryAt) return null;
  const client = createClient({
    url: process.env.CACHE_REDIS_URL,
    disableOfflineQueue: true,
    socket: { connectTimeout: 500, reconnectStrategy: false },
  });
  client.on('error', () => {
    /* Cache failures are counted; application data stays in PostgreSQL. */
  });
  state.connecting = client
    .connect()
    .then(() => {
      state.client = client;
      return client;
    })
    .catch(() => {
      state.errors++;
      state.retryAt = Date.now() + 5000;
      return null;
    })
    .finally(() => {
      state.connecting = null;
    });
  return state.connecting;
}

async function command(args) {
  const client = await getClient();
  if (!client) return null;
  try {
    return await client.sendCommand(args, { signal: AbortSignal.timeout(500) });
  } catch {
    state.errors++;
    state.retryAt = Date.now() + 5000;
    if (state.client === client) state.client = null;
    if (client.isOpen) await client.disconnect().catch(() => undefined);
    return null;
  }
}

async function readCache(key) {
  const value = await command(['GET', key]);
  if (value === null) state.misses++;
  else state.hits++;
  return typeof value === 'string' ? value : null;
}

async function writeCache(key, value, ttlMs) {
  if (Buffer.byteLength(value, 'utf8') > 1024 * 1024) return;
  if (
    await command([
      'SET',
      key,
      value,
      'PX',
      String(Math.max(1, Math.ceil(ttlMs))),
    ])
  )
    state.writes++;
}

async function cacheHealth() {
  const configured = Boolean(process.env.CACHE_REDIS_URL);
  return {
    configured,
    connected: configured && (await command(['PING'])) === 'PONG',
  };
}

async function closeCache() {
  if (state.connecting) await state.connecting;
  const client = state.client;
  state.client = null;
  if (client?.isOpen) await client.disconnect();
}

async function consumeSearchRateLimit(userDigest, cost) {
  const result = await command([
    'EVAL',
    `
    local count=tonumber(redis.call('GET',KEYS[1]) or '0')
    if count+tonumber(ARGV[1])>120 then
      return {0,math.max(1,redis.call('TTL',KEYS[1]))}
    end
    local next=redis.call('INCRBY',KEYS[1],ARGV[1])
    if next==tonumber(ARGV[1]) then redis.call('EXPIRE',KEYS[1],60) end
    return {1,math.max(1,redis.call('TTL',KEYS[1]))}
  `,
    '1',
    `${
      process.env.CACHE_KEY_PREFIX || 'puretv:cache'
    }:search-rate:v1:${userDigest}`,
    String(cost),
  ]);
  return Array.isArray(result)
    ? { allowed: Number(result[0]) === 1, retryAfter: Number(result[1]) }
    : null;
}

module.exports = {
  readCache,
  writeCache,
  cacheHealth,
  closeCache,
  consumeSearchRateLimit,
};
