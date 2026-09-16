/** @jest-environment node */
require('./web-globals');
const bs58 = require('bs58').default;
const {
  migrateConfigSubscriptions,
  mergeSubscriptionConfigs,
  applySubscriptionConfig,
  validateSubscriptions,
  parseSubscriptionConfig,
} = require('../src/lib/config-subscriptions');
const {
  refreshSubscriptions,
  fetchSubscriptionContent,
} = require('../src/lib/server/config-subscriptions');
const nativeFetch = global.fetch;
beforeEach(() => {
  global.fetch = jest.fn();
});
afterEach(() => {
  global.fetch = nativeFetch;
});

const site = (api, name = 'Video') => ({
  api: `https://example.com/${api}`,
  name,
});
const content = (sites, extra = {}) =>
  JSON.stringify({ api_site: sites, ...extra });
const sub = (ID, sites, extra = {}) => ({
  ID,
  Name: ID,
  URL: `https://example.com/${ID}.txt`,
  Enabled: true,
  AutoUpdate: true,
  LastCheck: '2026-09-12T00:00:00.000Z',
  ConfigContent: content(sites),
  ...extra,
});
const config = (subscriptions = []) => ({
  ConfigSubscriptions: subscriptions,
  ConfigFileLocal: '{}',
  ConfigFile: '{}',
  ConfigSubscribtion: { URL: '', AutoUpdate: false, LastCheck: '' },
  SourceConfig: [],
  LiveConfig: [],
  CustomCategories: [],
});

afterEach(() => jest.clearAllMocks());

test('migrates an existing single subscription once and keeps an explicitly empty list empty', () => {
  const original = {
    ConfigFile: content({ old: site('old') }),
    ConfigSubscribtion: {
      URL: 'https://example.com/old.txt',
      AutoUpdate: true,
      LastCheck: '2026-09-12T00:00:00.000Z',
    },
  };
  migrateConfigSubscriptions(original);
  expect(original.ConfigSubscriptions[0]).toMatchObject({
    ID: 'legacy',
    ConfigContent: original.ConfigFile,
    AutoUpdate: true,
  });
  expect(original.ConfigFileLocal).toBe('{}');
  original.ConfigSubscriptions = [];
  migrateConfigSubscriptions(original);
  expect(original.ConfigSubscriptions).toEqual([]);
  const manual = { ConfigFile: content({ local: site('local') }) };
  migrateConfigSubscriptions(manual);
  expect(manual.ConfigFileLocal).toBe(manual.ConfigFile);
});

test('deduplicates equivalent APIs, keeps local priority, and preserves different APIs sharing a key', () => {
  const merged = mergeSubscriptionConfigs(
    content({ local: site('shared', 'Local') }),
    [
      sub('a', { duplicate: site('shared/'), clash: site('first') }),
      sub('b', { clash: site('second'), alias: site('first/') }),
    ]
  );
  expect(Object.keys(merged.api_site)).toEqual(['local', 'clash', 'clash__b']);
  expect(merged.api_site.local.name).toBe('Local');
  expect(merged.api_site.clash__b.api).toBe('https://example.com/second');
});

test('keeps source keys stable across reorder and removal of the first duplicate provider', () => {
  const a = sub('a', { same: site('a') });
  const b = sub('b', { same: site('b'), different: site('a') });
  const first = mergeSubscriptionConfigs('{}', [a, b]);
  const second = mergeSubscriptionConfigs('{}', [b, a], JSON.stringify(first));
  expect(second.api_site).toEqual(first.api_site);
  const third = mergeSubscriptionConfigs('{}', [b], JSON.stringify(second));
  expect(third.api_site).toEqual(first.api_site);
});

test('merges categories and live lists and remaps special sources after a key collision', () => {
  const a = sub(
    'a',
    { same: site('a') },
    {
      ConfigContent: content(
        { same: site('a') },
        {
          custom_category: [{ name: 'Film', type: 'movie', query: 'recent' }],
          lives: { tv: { name: 'TV', url: 'https://example.com/tv.m3u' } },
        }
      ),
    }
  );
  const b = sub(
    'b',
    {},
    {
      ConfigContent: content(
        { same: site('b') },
        {
          custom_category: [
            { type: 'movie', query: 'recent' },
            { type: 'tv', query: 'recent' },
          ],
          lives: {
            copy: { name: 'TV copy', url: 'https://example.com/tv.m3u' },
          },
          special_source_apis: ['same'],
        }
      ),
    }
  );
  const merged = mergeSubscriptionConfigs('{}', [a, b]);
  expect(merged.custom_category).toHaveLength(2);
  expect(Object.keys(merged.lives)).toHaveLength(1);
  expect(merged.special_source_apis).toEqual(['same__b']);
});

test.each(['disabled', 'deleted', 'removed-upstream'])(
  '%s removes only obsolete subscription-owned sources',
  (mode) => {
    const a = sub('a', { old: site('old'), shared: site('shared') });
    const b = sub('b', { shared: site('shared') });
    const state = config([a, b]);
    state.ConfigFile = JSON.stringify(mergeSubscriptionConfigs('{}', [a, b]));
    state.SourceConfig = [
      { key: 'old', ...site('old'), from: 'config' },
      {
        key: 'shared',
        ...site('shared'),
        from: 'config',
        disabled: true,
        weight: 5,
      },
      { key: 'manual', ...site('manual'), from: 'custom' },
    ];
    const next =
      mode === 'deleted'
        ? [b]
        : [
            mode === 'disabled'
              ? { ...a, Enabled: false }
              : { ...a, ConfigContent: '{}' },
            b,
          ];
    applySubscriptionConfig(state, '{}', next);
    expect(state.SourceConfig.map((item) => item.key)).toEqual([
      'shared',
      'manual',
    ]);
    expect(state.SourceConfig[0]).toMatchObject({ disabled: true, weight: 5 });
    expect(Object.keys(JSON.parse(state.ConfigFile).api_site)).toEqual([
      'shared',
    ]);
  }
);

test('failed refresh keeps its cache and success timestamp while other subscriptions update', async () => {
  const original = [
    sub('good', { old: site('old') }),
    sub('bad', { cached: site('cached') }),
  ];
  const fetcher = jest.fn(async (url) => {
    if (url.includes('bad')) throw new Error('offline');
    return content({ fresh: site('fresh') });
  });
  const updated = await refreshSubscriptions(original, {}, fetcher);
  expect(updated[0].ConfigContent).toContain('fresh');
  expect(updated[1]).toMatchObject({ ...original[1], LastError: 'offline' });
  expect(original[1].LastError).toBeUndefined();
  expect(Object.keys(mergeSubscriptionConfigs('{}', updated).api_site)).toEqual(
    ['fresh', 'cached']
  );
});

test('does not overwrite a manual source when an imported source uses its key', () => {
  const state = config();
  state.SourceConfig = [{ key: 'shared', ...site('manual'), from: 'custom' }];
  applySubscriptionConfig(state, '{}', [
    sub('a', { shared: site('imported') }),
  ]);
  expect(state.SourceConfig[0].api).toBe('https://example.com/manual');
  const effective = JSON.parse(state.ConfigFile);
  expect(effective.api_site.shared).toBeUndefined();
  expect(effective.api_site.shared__subscription.api).toBe(
    'https://example.com/imported'
  );
});

test('automatic updates skip disabled/manual entries and a targeted update touches just one entry', async () => {
  const entries = [
    sub('auto', {}),
    sub('manual', {}, { AutoUpdate: false }),
    sub('disabled', {}, { Enabled: false }),
  ];
  const fetcher = jest.fn(async () => '{}');
  await refreshSubscriptions(entries, { automatic: true }, fetcher);
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([entries[0].URL]);
  fetcher.mockClear();
  await refreshSubscriptions(entries, { id: 'manual' }, fetcher);
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([entries[1].URL]);
});

test('invalid upstream configuration preserves the last good copy', async () => {
  const original = sub('a', { good: site('good') });
  const [updated] = await refreshSubscriptions(
    [original],
    {},
    async () => '{"api_site":{"bad":{"api":"file:///x"}}}'
  );
  expect(updated.ConfigContent).toBe(original.ConfigContent);
  expect(updated.LastError).toBeTruthy();
});

test.each(['json', 'base58'])(
  'fetches %s configuration with surrounding whitespace',
  async (format) => {
    const json = content({ test: site('test') });
    const body = format === 'json' ? json : bs58.encode(Buffer.from(json));
    global.fetch.mockResolvedValue(new Response(`\n ${body}\r\n`));
    expect(
      JSON.parse(
        await fetchSubscriptionContent('https://example.com/config.txt')
      )
    ).toEqual(JSON.parse(json));
  }
);

test('rejects duplicate addresses/IDs, invalid schemes and malformed config structures', () => {
  expect(() => validateSubscriptions([sub('a', {}), sub('a', {})])).toThrow();
  expect(() =>
    validateSubscriptions([
      sub('a', {}),
      { ...sub('b', {}), URL: 'https://example.com/a.txt#copy' },
    ])
  ).toThrow();
  expect(() =>
    validateSubscriptions([{ ...sub('a', {}), URL: 'file:///tmp/config' }])
  ).toThrow();
  expect(() =>
    validateSubscriptions(
      Array.from({ length: 21 }, (_, index) => sub(`s${index}`, {}))
    )
  ).toThrow();
  for (const text of [
    'null',
    '[]',
    '{"api_site":[]}',
    '{"api_site":{"__proto__":{"api":"https://example.com","name":"x"}}}',
  ]) {
    expect(() => parseSubscriptionConfig(text)).toThrow();
  }
});


test('automatic refresh respects independent intervals and records failed attempts', async () => {
  const base = { ID: 'interval', Name: 'interval', URL: 'https://example.com/interval', Enabled: true, AutoUpdate: true, LastCheck: '', LastAttempt: new Date().toISOString(), UpdateIntervalHours: 24 };
  const fetcher = jest.fn().mockRejectedValue(new Error('offline'));
  await refreshSubscriptions([base], { automatic: true, retries: 0 }, fetcher); expect(fetcher).not.toHaveBeenCalled();
  const result = await refreshSubscriptions([{ ...base, LastAttempt: '' }], { automatic: true, retries: 0 }, fetcher);
  expect(result[0].LastAttempt).toBeTruthy(); expect(result[0].LastError).toBe('offline'); expect(result[0].LastCheck).toBe('');
});
test('transient subscription fetch failures retry before accepting the new cache', async () => {
  const fetcher = jest.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue('{}');
  const base = { ID: 'retry', Name: 'retry', URL: 'https://example.com/retry', Enabled: true, AutoUpdate: true, LastCheck: '' };
  const [result] = await refreshSubscriptions([base], { retries: 1 }, fetcher);
  expect(fetcher).toHaveBeenCalledTimes(2); expect(result.ConfigContent).toBe('{}'); expect(result.LastError).toBe('');
});
