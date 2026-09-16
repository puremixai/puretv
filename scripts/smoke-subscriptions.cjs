let configVersion = 0;
// Integration test against a disposable Docker container; never uses the user's database.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');

const name = `puretv-subscriptions-smoke-${randomBytes(4).toString('hex')}`;
const password = randomBytes(24).toString('hex');
const cronSecret = randomBytes(24).toString('hex');
const username = 'subscriptions-smoke';
const docker = (args, options = {}) =>
  execFileSync('docker', args, { encoding: 'utf8', ...options }).trim();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const source = (key) => ({ name: key, api: `https://example.com/${key}` });
const json = (api_site) => JSON.stringify({ api_site });
const sub = (ID, URL, sites = {}, extra = {}) => ({
  ID,
  Name: ID,
  URL,
  Enabled: true,
  AutoUpdate: false,
  LastCheck: '',
  ConfigContent: json(sites),
  ...extra,
});
let origin, cookie;

async function request(path, body, headers = {}) {
  const response = await fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      'sec-fetch-site': 'same-origin',
      ...(cookie ? { cookie } : {}),
      'x-config-version': String(configVersion),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60_000),
  });
  return response;
}
async function ready() {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      if (
        (await fetch(origin + '/login', { signal: AbortSignal.timeout(1000) }))
          .ok
      )
        return;
    } catch {
      /* Starting. */
    }
    await delay(500);
  }
  throw new Error('Docker test server did not start');
}
async function readConfig() {
  const response = await request('/api/admin/config');
  assert.equal(response.status, 200);
  const config = (await response.json()).Config;
  configVersion = config.ConfigVersion || 0;
  return config;
}
async function restart() {
  docker(['restart', name]);
  // Docker can assign a different host port when restarting an ephemeral mapping.
  origin = `http://${docker(['port', name, '3000/tcp']).split('\n')[0]}`;
  await ready();
}
async function save(local, subscriptions) {
  const response = await request('/api/admin/config_file', {
    configFile: local,
    subscriptions,
  });
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  return readConfig();
}

(async () => {
  try {
    docker(
      [
        'run',
        '-d',
        '--name',
        name,
        '--init',
        '-p',
        '127.0.0.1::3000',
        '-e',
        'PASSWORD',
        '-e',
        'AUTH_SECRET',
        '-e',
        'CRON_SECRET',
        '-e',
        `USERNAME=${username}`,
        '-e',
        `ADMIN_USERNAME=${username}`,
        '-e',
        'NEXT_PUBLIC_STORAGE_TYPE=d1',
        '-e',
        'SQLITE_DB_PATH=/tmp/subscriptions.db',
        '-e',
        'HOSTNAME=0.0.0.0',
        '-e',
        'PORT=3000',
        '-e',
        'CRON_WAIT_FOR_COMPLETION=true',
        process.env.SMOKE_IMAGE || 'puretv:local',
      ],
      {
        env: {
          ...process.env,
          PASSWORD: password,
          AUTH_SECRET: randomBytes(32).toString('hex'),
          CRON_SECRET: cronSecret,
        },
      }
    );
    origin = `http://${docker(['port', name, '3000/tcp']).split('\n')[0]}`;
    await ready();
    assert.equal(
      (
        await request('/api/admin/config_subscription/fetch', {
          subscriptions: [],
        })
      ).status,
      401
    );
    const login = await request('/api/login', { username, password });
    assert.equal(login.status, 200, 'owner login');
    cookie = login.headers
      .getSetCookie()
      .find((item) => item.startsWith('auth='))
      .split(';')[0];

    // Seed the real legacy database shape, then restart to exercise startup migration.
    const legacy = await readConfig();
    delete legacy.ConfigSubscriptions;
    delete legacy.ConfigFileLocal;
    legacy.ConfigFile = json({ legacy: source('legacy') });
    legacy.ConfigSubscribtion = {
      URL: 'https://example.com/legacy.txt',
      AutoUpdate: false,
      LastCheck: '',
    };
    legacy.SourceConfig = [
      { key: 'legacy', ...source('legacy'), from: 'config', disabled: false },
    ];
    docker(
      [
        'exec',
        '-i',
        '--user',
        '1001',
        name,
        'node',
        '-e',
        "const db = new (require('better-sqlite3'))(process.env.SQLITE_DB_PATH); db.prepare('UPDATE admin_config SET config = ? WHERE id = 1').run(require('fs').readFileSync(0, 'utf8')); db.close();",
      ],
      { input: JSON.stringify(legacy) }
    );
    await restart();
    const migrated = await readConfig();
    assert.equal(migrated.ConfigSubscriptions.length, 1);
    assert.equal(migrated.ConfigSubscriptions[0].ID, 'legacy');
    assert.equal(migrated.ConfigFileLocal, '{}');
    console.log('PASS: real SQLite legacy migration after container restart');

    const urls = [
      'https://raw.githubusercontent.com/hafrey1/LunaTV-config/refs/heads/main/jin18.txt',
      'https://raw.githubusercontent.com/netput-web/LunaTV-config/refs/heads/main/jin18.txt',
      'https://raw.githubusercontent.com/hafrey1/LunaTV-config/refs/heads/main/jin18.json',
    ];
    const missing =
      'https://raw.githubusercontent.com/hafrey1/LunaTV-config/refs/heads/main/moontv-smoke-missing-subscription.json';
    const previewResponse = await request(
      '/api/admin/config_subscription/fetch',
      {
        configFile: '{}',
        subscriptions: [
          ...urls.map((url, index) => sub(`public-${index}`, url)),
          sub('offline', missing, { cached: source('cached') }),
        ],
      }
    );
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json();
    assert.equal(
      preview.failedCount,
      1,
      JSON.stringify(
        preview.subscriptions.map(({ Name, LastError }) => ({
          Name,
          LastError,
        }))
      )
    );
    assert(preview.sourceCount > 1);
    const total = preview.subscriptions.reduce(
      (sum, item) =>
        sum + Object.keys(JSON.parse(item.ConfigContent).api_site || {}).length,
      0
    );
    assert(preview.sourceCount < total, 'real subscriptions were deduplicated');
    assert.equal(
      (await readConfig()).ConfigSubscriptions.length,
      1,
      'preview is not persisted'
    );
    console.log(
      `PASS: 3 real JSON/Base58 subscriptions, de-duplication (${total} -> ${preview.sourceCount}), failed subscription cache retained`
    );

    const local = json({ manual: source('manual') });
    const a = sub('a', urls[0], {
      common: source('common'),
      same: source('a-only'),
    });
    const b = sub(
      'b',
      missing,
      { common: source('common'), same: source('b-only') },
      { AutoUpdate: true }
    );
    let saved = await save(local, [a, b]);
    assert.equal(saved.ConfigSubscriptions.length, 2);
    assert.equal(saved.SourceConfig.length, 4);
    assert.equal(new Set(saved.SourceConfig.map((item) => item.api)).size, 4);
    assert(!saved.SourceConfig.some((item) => item.key === 'legacy'));
    assert(saved.SourceConfig.some((item) => item.key === 'same__b'));

    // The production entry point runs Cron at startup. This also avoids its cooldown.
    await restart();
    for (let attempt = 0; attempt < 60; attempt++) {
      saved = await readConfig();
      if (saved.ConfigSubscriptions[1].LastError) break;
      await delay(500);
    }
    assert(saved.ConfigSubscriptions[1].LastError.includes('404'));
    assert.equal(saved.ConfigSubscriptions[1].ConfigContent, b.ConfigContent);
    assert.equal(saved.SourceConfig.length, 4);
    assert.equal(
      saved.ConfigSubscriptions[0].LastCheck,
      '',
      'manual-only subscription skipped by cron'
    );
    console.log(
      'PASS: save/apply, independent automatic updates and failure isolation'
    );

    const disabled = await save(local, [
      { ...a, Enabled: false },
      saved.ConfigSubscriptions[1],
    ]);
    assert.equal(disabled.SourceConfig.length, 3);
    assert(
      !disabled.SourceConfig.some((item) => item.api === source('a-only').api)
    );
    assert(disabled.SourceConfig.some((item) => item.key === 'same__b'));
    const removed = await save(local, []);
    assert.deepEqual(
      removed.SourceConfig.map((item) => item.api),
      [source('manual').api]
    );
    await restart();
    const persisted = await readConfig();
    assert.deepEqual(persisted.ConfigSubscriptions, []);
    assert.equal(persisted.ConfigFileLocal, local);
    assert.equal(persisted.SourceConfig.length, 1);
    console.log(
      'PASS: disable/delete cleanup, manual source preserved, empty list persists after restart'
    );
  } finally {
    docker(['rm', '-f', name]);
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
