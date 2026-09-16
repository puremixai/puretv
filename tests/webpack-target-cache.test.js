/** @jest-environment node */
const {
  configureWebpack,
  nextCache,
  runCacheSequence,
} = require('./helpers/webpack-cache-fixture.cjs');

test('Node, Cloudflare and EdgeOne builds use distinct filesystem cache names and versions', () => {
  const caches = [
    configureWebpack().cache,
    configureWebpack({ BUILD_TARGET: 'cloudflare' }).cache,
    configureWebpack({ BUILD_TARGET: 'edgeone' }).cache,
  ];

  expect(new Set(caches.map((cache) => cache.name)).size).toBe(3);
  expect(new Set(caches.map((cache) => cache.version)).size).toBe(3);
  for (const cache of caches) {
    expect(cache.name).toContain('server-production');
    expect(cache.version).toContain('next-fingerprint');
    expect(cache.cacheDirectory).toBe('fixture/cache');
  }
});

test.each([
  [{}, { BUILD_TARGET: 'node' }],
  [{ BUILD_TARGET: 'cloudflare' }, { CF_PAGES: '1' }],
  [{ BUILD_TARGET: 'edgeone' }, { EDGEONE_PAGES: '1' }],
])(
  'equivalent target environments %j and %j reuse their own cache',
  (first, second) => {
    const firstCache = configureWebpack(first).cache;
    const secondCache = configureWebpack(second).cache;
    expect(secondCache.name).toBe(firstCache.name);
    expect(secondCache.version).toBe(firstCache.version);
  }
);

test.each(['client-production', 'server-production', 'edge-server-production'])(
  'retains Next compiler identity %s while separating deployment targets',
  (name) => {
    const cache = configureWebpack(
      { BUILD_TARGET: 'cloudflare' },
      { cache: { ...nextCache(), name } }
    ).cache;
    expect(cache.name).toContain(name);
    expect(cache.version).toContain('next-fingerprint');
  }
);

test.each([{}, { BUILD_TARGET: 'cloudflare' }, { BUILD_TARGET: 'edgeone' }])(
  'preserves an explicitly disabled cache under %j',
  (env) => {
    expect(configureWebpack(env, { cache: false }).cache).toBe(false);
  }
);

test.each(['cloudflare', 'edgeone'])(
  'real Webpack keeps the native constructor after %s -> Node -> Edge builds',
  async (edgeTarget) => {
    const results = await runCacheSequence({ edgeTarget });
    expect(results.map((entry) => entry.result)).toEqual([
      'edge-shim',
      'native-driver',
      'edge-shim',
    ]);
    expect(results[2].cacheName).toBe(results[0].cacheName);
    expect(results[1].cacheName).not.toBe(results[0].cacheName);
  },
  30000
);
