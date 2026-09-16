/** @jest-environment node */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Response, Blob } = require('node:vm').runInThisContext('globalThis');
const { execFileSync } = require('node:child_process');
const { createWorkerRuntime } = require('./helpers/service-worker-runtime.cjs');

let fixture;
beforeAll(async () => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'puretv-pwa-test-'));
  for (const dir of [
    'public/icons',
    'public/fonts',
    'public/players',
    'public/assets/jassub',
    'public/scripts',
    '.next/static/chunks',
    '.next/server/app',
  ]) {
    fs.mkdirSync(path.join(fixture, dir), { recursive: true });
  }
  fs.writeFileSync(path.join(fixture, 'public/icons/logo.png'), 'image');
  fs.writeFileSync(path.join(fixture, 'public/fonts/site.woff2'), 'font');
  fs.writeFileSync(path.join(fixture, 'public/players/vlc.png'), 'player-icon');
  for (const file of [
    'jassub-worker.js',
    'jassub-worker.wasm',
    'jassub-worker-modern.wasm',
    'default.woff2',
    'NotoSansCJK-Regular.ttc',
  ]) {
    fs.writeFileSync(
      path.join(fixture, 'public/assets/jassub', file),
      'on-demand'
    );
  }
  fs.writeFileSync(
    path.join(fixture, 'public/scripts/bangumi-proxy.worker.js'),
    'on-demand-settings-script'
  );
  fs.writeFileSync(
    path.join(fixture, '.next/static/chunks/app.js'),
    'globalThis.testApp = true;'
  );
  fs.writeFileSync(
    path.join(fixture, '.next/server/app/private.html'),
    'PRIVATE SERVER RESPONSE'
  );
  fs.copyFileSync(
    path.join(__dirname, '../public/push-sw.js'),
    path.join(fixture, 'public/push-sw.js')
  );
  execFileSync(
    process.execPath,
    [path.join(__dirname, '../scripts/generate-pwa.cjs'), '--root', fixture],
    {
      cwd: path.join(__dirname, '..'),
      stdio: 'pipe',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        BUILD_TARGET: '',
        CF_PAGES: '',
        EDGEONE_PAGES: '',
        NEXT_PUBLIC_BASE_PATH: '',
      },
    }
  );
}, 30000);
afterAll(() => fs.rmSync(fixture, { recursive: true, force: true }));

test.each([
  ['/api/search?q=test', {}],
  ['/api/admin/config', {}],
  ['/api/subtitle.wasm', {}],
  ['/play?id=private', { navigation: true }],
  ['/play?_rsc=private', { headers: { RSC: '1' } }],
  ['/_next/data/build/private.json', {}],
])('generated worker never stores private request %s', async (url, options) => {
  const worker = createWorkerRuntime(path.join(fixture, 'public'));
  const response = await worker.request(url, options);
  expect(response.status).toBe(200);
  expect(
    [...worker.cacheStores.values()].every((entries) => entries.size === 0)
  ).toBe(true);
});

test('generated worker preserves offline static images, fonts and built JavaScript', async () => {
  const worker = createWorkerRuntime(path.join(fixture, 'public'));
  await worker.install();
  await worker.activate();
  worker.setOffline(true);
  for (const url of [
    '/icons/logo.png',
    '/fonts/site.woff2',
    '/players/vlc.png',
    '/_next/static/chunks/app.js',
  ]) {
    expect(await (await worker.request(url)).text()).toBe('network:' + url);
  }
  await expect(
    worker.request('/private', { navigation: true })
  ).rejects.toThrow();
});

test('installation does not preload subtitle assets or the optional worker settings script', async () => {
  const worker = createWorkerRuntime(path.join(fixture, 'public'));
  await worker.install();
  await worker.activate();
  const installedPaths = worker.fetchCalls.map((url) => new URL(url).pathname);
  expect(installedPaths).toContain('/players/vlc.png');
  expect(installedPaths.some((url) => url.startsWith('/assets/jassub/'))).toBe(
    false
  );
  expect(installedPaths).not.toContain('/scripts/bangumi-proxy.worker.js');

  // Excluding these files from installation must still allow an on-demand request.
  const response = await worker.request('/assets/jassub/jassub-worker.wasm');
  expect(await response.text()).toBe(
    'network:/assets/jassub/jassub-worker.wasm'
  );
  expect(worker.cacheStores.get('static-code-assets')?.size).toBe(1);
  worker.setOffline(true);
  expect(
    await (await worker.request('/assets/jassub/jassub-worker.wasm')).text()
  ).toBe('network:/assets/jassub/jassub-worker.wasm');
});

test('activation removes old private entries but retains static and offline video assets', async () => {
  const worker = createWorkerRuntime(path.join(fixture, 'public'));
  const cache = await worker.caches.open('others');
  const paths = [
    '/api/favorites',
    '/play?_rsc=old',
    '/admin',
    '/_next/static/a.js',
    '/__puretv_idb_video__/movie/playlist.m3u8',
  ];
  for (const url of paths) await cache.put(url, new Response('old'));
  await worker.activate();
  expect(
    (await cache.keys()).map((request) => new URL(request.url).pathname)
  ).toEqual([
    '/_next/static/a.js',
    '/__puretv_idb_video__/movie/playlist.m3u8',
  ]);
});

test('generated worker imports the push and IndexedDB offline video handlers', async () => {
  const worker = createWorkerRuntime(path.join(fixture, 'public'));
  worker.idbStores.set(
    'manifests',
    new Map([
      [
        'movie',
        { completed: true, playlistContent: '#EXTM3U\nsegment_00000.ts' },
      ],
    ])
  );
  worker.idbStores.set(
    'segments',
    new Map([
      ['movie:segment:0', { data: new Blob(['video-segment']), size: 13 }],
    ])
  );
  worker.setOffline(true);
  expect(worker.handlers.has('push')).toBe(true);
  expect(
    await (
      await worker.request('/__puretv_idb_video__/movie/playlist.m3u8')
    ).text()
  ).toBe('#EXTM3U\nsegment_00000.ts');
  expect(
    await (
      await worker.request('/__puretv_idb_video__/movie/segment_00000.ts')
    ).text()
  ).toBe('video-segment');
  expect(worker.fetchCalls).toHaveLength(0);
});

test('a custom scope generates matching static and push URLs without caching scoped APIs', async () => {
  execFileSync(
    process.execPath,
    [path.join(__dirname, '../scripts/generate-pwa.cjs'), '--root', fixture],
    {
      cwd: path.join(__dirname, '..'),
      stdio: 'pipe',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        BUILD_TARGET: '',
        CF_PAGES: '',
        EDGEONE_PAGES: '',
        NEXT_PUBLIC_BASE_PATH: '/puretv/',
      },
    }
  );
  const worker = createWorkerRuntime(path.join(fixture, 'public'), '/puretv/');
  await worker.install();
  await worker.activate();
  expect(worker.handlers.has('push')).toBe(true);
  const response = await worker.request('/puretv/api/favorites');
  expect(response.status).toBe(200);
  expect(
    [...worker.cacheStores.values()].every((entries) =>
      [...entries.keys()].every((url) => !url.includes('/api/'))
    )
  ).toBe(true);
  worker.setOffline(true);
  expect(
    await (await worker.request('/puretv/_next/static/chunks/app.js')).text()
  ).toBe('network:/puretv/_next/static/chunks/app.js');
});

test.each(['cloudflare', 'edgeone'])(
  'edge %s output skips standalone service-worker generation',
  (target) => {
    const script = path.join(__dirname, '../scripts/generate-pwa.cjs');
    const output = execFileSync(
      process.execPath,
      [script, '--root', path.join(fixture, 'no-build')],
      {
        cwd: path.join(__dirname, '..'),
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_ENV: 'production',
          BUILD_TARGET: target,
          CF_PAGES: '',
          EDGEONE_PAGES: '',
        },
      }
    );
    expect(output).toContain('Skipped');
    expect(fs.existsSync(path.join(fixture, 'no-build/public/sw.js'))).toBe(
      false
    );
  }
);
