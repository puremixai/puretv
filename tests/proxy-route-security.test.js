/** @jest-environment node */
require('./web-globals');
global.fetch = require('vm').runInThisContext('fetch');
global.crypto = require('crypto').webcrypto;
const dns = require('dns');
const { Readable } = require('stream');
const { NextRequest } = require('next/server');
jest.mock('node-fetch', () => jest.fn());
jest.mock('../src/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('../src/lib/db', () => ({
  db: { getUserInfoV2: jest.fn(), getUsernameByTvboxToken: jest.fn() },
  getStorage: jest.fn(),
}));
const nodeFetch = require('node-fetch');
const { getConfig } = require('../src/lib/config');
const { db } = require('../src/lib/db');
const { signAuthData } = require('../src/lib/auth-signature');
const routes = Object.fromEntries(
  ['image-proxy', 'proxy/logo', 'proxy/m3u8', 'proxy/key', 'proxy/segment'].map(
    (path) => [path, require('../src/app/api/' + path + '/route').GET],
  ),
);
let cookie;
function reply(body = 'image', type = 'image/png', status = 200, headers = {}) {
  return {
    status,
    statusText: 'OK',
    headers: new Headers({ 'content-type': type, ...headers }),
    body: Readable.from([Buffer.from(body)]),
  };
}
function request(path, url = 'https://cdn.example/asset', options = {}) {
  const query = new URLSearchParams({
    url,
    'puretv-source': 'live',
    ...(options.query || {}),
  });
  return new NextRequest('https://site.example/api/' + path + '?' + query, {
    headers: {
      ...(options.anonymous ? {} : { cookie: 'auth=' + cookie }),
      ...(options.headers || {}),
    },
  });
}
beforeEach(async () => {
  jest.resetAllMocks();
  process.env.PASSWORD = 'proxy-route-test-secret';
  process.env.USERNAME = 'owner';
  process.env.NEXT_PUBLIC_STORAGE_TYPE = 'localstorage';
  delete process.env.AUTH_SECRET;
  delete process.env.LIVE_PROXY_TRUSTED_ORIGINS;
  delete process.env.PROXY_M3U8_TOKEN;
  delete process.env.TVBOX_SUBSCRIBE_TOKEN;
  const auth = {
    version: 2,
    username: 'owner',
    role: 'owner',
    timestamp: Date.now(),
    refreshExpires: Date.now() + 86400000,
  };
  auth.signature = await signAuthData(auth);
  cookie = encodeURIComponent(JSON.stringify(auth));
  getConfig.mockResolvedValue({
    SiteConfig: {},
    LiveConfig: [
      {
        key: 'live',
        url: 'https://playlist.example/list.m3u',
        ua: 'IPTV-test',
      },
    ],
  });
  jest
    .spyOn(dns.promises, 'lookup')
    .mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  jest.spyOn(global, 'fetch').mockImplementation(() => {
    throw new Error('Unpinned global fetch is forbidden');
  });
  nodeFetch.mockImplementation(async () => reply());
});
afterEach(() => jest.restoreAllMocks());

test.each(Object.entries(routes))(
  '%s rejects missing and invalid credentials before config, DB or network',
  async (path, handler) => {
    for (const headers of [{}, { cookie: 'auth=invalid' }]) {
      const response = await handler(
        request(path, undefined, { anonymous: true, headers }),
      );
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toContain('no-store');
    }
    expect(getConfig).not.toHaveBeenCalled();
    expect(db.getUserInfoV2).not.toHaveBeenCalled();
    expect(nodeFetch).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  },
);

test.each(Object.entries(routes))(
  '%s blocks private, encoded loopback, credentials, mixed DNS and private redirects at the real policy',
  async (path, handler) => {
    for (const url of [
      'http://127.1/secret',
      'http://0x7f000001/secret',
      'http://[::ffff:127.0.0.1]/secret',
      'http://169.254.169.254/latest/meta-data',
      'http://user:pass@cdn.example/secret',
      'file:///etc/passwd',
    ]) {
      const response = await handler(request(path, url));
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    expect(nodeFetch).not.toHaveBeenCalled();
    dns.promises.lookup.mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]);
    expect((await handler(request(path))).status).toBeGreaterThanOrEqual(400);
    expect(nodeFetch).not.toHaveBeenCalled();
    nodeFetch.mockResolvedValueOnce(
      reply('', 'image/png', 302, { location: 'http://127.0.0.1/private' }),
    );
    expect((await handler(request(path))).status).toBeGreaterThanOrEqual(400);
    expect(nodeFetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  },
);

test.each(Object.entries(routes))(
  '%s fetches public assets through a pinned connection without site credentials',
  async (path, handler) => {
    nodeFetch.mockResolvedValueOnce(
      reply(
        path.endsWith('m3u8') ? '#EXTM3U\nchunk%2Fone.ts?sig=a%2Fb' : 'asset',
        path.endsWith('m3u8') ? 'application/vnd.apple.mpegurl' : 'image/png',
      ),
    );
    const response = await handler(
      request(path, 'https://cdn.example/asset%2Fone?sig=a%2Fb'),
    );
    expect(response.status).toBe(200);
    await response.text();
    const [url, options] = nodeFetch.mock.calls[0];
    expect(url).toBe('https://cdn.example/asset%2Fone?sig=a%2Fb');
    expect(options.redirect).toBe('manual');
    expect(options.headers.cookie).toBeUndefined();
    const callback = jest.fn();
    options.agent.options.lookup('cdn.example', { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [
      { address: '93.184.216.34', family: 4 },
    ]);
    expect(response.headers.get('cache-control')).toContain('private');
  },
);

test('LAN live access is bounded to the enabled source origin and configured per-source origins', async () => {
  getConfig.mockResolvedValue({
    SiteConfig: {},
    LiveConfig: [{ key: 'live', url: 'http://192.168.1.20:8080/channels.m3u' }],
  });
  const allowed = await routes['proxy/segment'](
    request('proxy/segment', 'http://192.168.1.20:8080/chunk.ts'),
  );
  expect(allowed.status).toBe(200);
  await allowed.text();
  nodeFetch.mockClear();
  for (const url of [
    'http://192.168.1.21:8080/chunk.ts',
    'http://192.168.1.20:8081/chunk.ts',
  ])
    expect(
      (await routes['proxy/segment'](request('proxy/segment', url))).status,
    ).toBeGreaterThanOrEqual(400);
  expect(nodeFetch).not.toHaveBeenCalled();
  process.env.LIVE_PROXY_TRUSTED_ORIGINS = JSON.stringify({
    live: ['http://192.168.1.21:8080'],
  });
  const explicit = await routes['proxy/segment'](
    request('proxy/segment', 'http://192.168.1.21:8080/chunk.ts'),
  );
  expect(explicit.status).toBe(200);
  await explicit.text();
  getConfig.mockResolvedValue({
    SiteConfig: {},
    LiveConfig: [
      {
        key: 'live',
        url: 'http://192.168.1.20:8080/channels.m3u',
        disabled: true,
      },
    ],
  });
  expect(
    (
      await routes['proxy/segment'](
        request('proxy/segment', 'http://192.168.1.20:8080/chunk.ts'),
      )
    ).status,
  ).toBe(404);
});

test('Bangumi configured LAN base is used only for actual Bangumi image URLs', async () => {
  getConfig.mockResolvedValue({
    SiteConfig: { BangumiImageBaseUrl: 'http://127.0.0.1:8090/images' },
    LiveConfig: [],
  });
  const response = await routes['image-proxy'](
    request('image-proxy', 'https://lain.bgm.tv/pic/cover.jpg', {
      query: { source: 'bangumi' },
    }),
  );
  expect(response.status).toBe(200);
  await response.text();
  expect(nodeFetch.mock.calls[0][0]).toBe(
    'http://127.0.0.1:8090/images/https://lain.bgm.tv/pic/cover.jpg',
  );
  nodeFetch.mockClear();
  for (const url of [
    'http://127.0.0.1:8090/private',
    'http://127.0.0.1:8090/images/http://169.254.169.254/',
    'http://169.254.169.254/',
  ]) {
    expect(
      (
        await routes['image-proxy'](
          request('image-proxy', url, { query: { source: 'bangumi' } }),
        )
      ).status,
    ).toBeGreaterThanOrEqual(400);
  }
  expect(nodeFetch).not.toHaveBeenCalled();
});

test('live playlist preserves media token, source encoding, final URL and nested/key/map URIs', async () => {
  process.env.PROXY_M3U8_TOKEN = 'media-secret';
  nodeFetch
    .mockResolvedValueOnce(
      reply('', '', 302, { location: '/nested/master.m3u8' }),
    )
    .mockResolvedValueOnce(
      reply(
        '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio.m3u8"\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-MAP:URI="init.mp4"\nchunk.ts',
        'application/vnd.apple.mpegurl',
      ),
    );
  const response = await routes['proxy/m3u8'](
    request('proxy/m3u8', undefined, {
      anonymous: true,
      query: { token: 'media-secret' },
    }),
  );
  expect(response.status).toBe(200);
  const playlist = await response.text();
  expect(playlist).toContain('https://site.example/api/proxy/m3u8?');
  expect(playlist).toContain('https%3A%2F%2Fcdn.example%2Fnested%2Fkey.bin');
  expect(playlist).toContain('token=media-secret');
  expect(playlist).toContain('puretv-source=live');
});

test('oversized keys and non-image active content are rejected', async () => {
  nodeFetch.mockResolvedValueOnce(
    reply('x'.repeat(65537), 'application/octet-stream'),
  );
  expect(
    (await routes['proxy/key'](request('proxy/key'))).status,
  ).toBeGreaterThanOrEqual(400);
  nodeFetch.mockResolvedValueOnce(
    reply('<script>alert(1)</script>', 'text/html'),
  );
  expect(
    (await routes['image-proxy'](request('image-proxy'))).status,
  ).toBeGreaterThanOrEqual(400);
});

test('Bangumi CONNECT pins both proxy and public destination without forwarding proxy credentials', async () => {
  const { HttpsProxyAgent } = require('https-proxy-agent');
  const connect = jest
    .spyOn(HttpsProxyAgent.prototype, 'connect')
    .mockResolvedValue({});
  getConfig.mockResolvedValue({
    SiteConfig: {
      BangumiProxy: 'http://proxy-user:proxy-secret@lan-proxy.example:7890',
    },
    LiveConfig: [],
  });
  dns.promises.lookup.mockImplementation(async (host) => [
    {
      address: host === 'lan-proxy.example' ? '192.168.1.2' : '93.184.216.34',
      family: 4,
    },
  ]);
  const response = await routes['image-proxy'](
    request('image-proxy', 'https://lain.bgm.tv/cover.jpg'),
  );
  expect(response.status).toBe(200);
  await response.text();
  const options = nodeFetch.mock.calls[0][1];
  const callback = jest.fn();
  options.agent.connectOpts.lookup(
    'lan-proxy.example',
    { all: true },
    callback,
  );
  expect(callback).toHaveBeenCalledWith(null, [
    { address: '192.168.1.2', family: 4 },
  ]);
  await options.agent.connect(
    {},
    { host: 'lain.bgm.tv', port: 443, secureEndpoint: true },
  );
  expect(connect).toHaveBeenCalledWith(
    {},
    expect.objectContaining({
      host: '93.184.216.34',
      servername: 'lain.bgm.tv',
    }),
  );
  expect(options.headers['proxy-authorization']).toBeUndefined();
  nodeFetch.mockClear();
  dns.promises.lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
  expect(
    (
      await routes['image-proxy'](
        request('image-proxy', 'https://lain.bgm.tv/cover.jpg'),
      )
    ).status,
  ).toBeGreaterThanOrEqual(400);
  expect(nodeFetch).not.toHaveBeenCalled();
});

test('trusted source redirect does not grant unrelated LAN hosts and metadata remains blocked', async () => {
  getConfig.mockResolvedValue({
    SiteConfig: {},
    LiveConfig: [{ key: 'live', url: 'http://192.168.1.20:8080/channels.m3u' }],
  });
  nodeFetch.mockResolvedValueOnce(
    reply('', '', 302, { location: 'http://192.168.1.21/private' }),
  );
  expect(
    (
      await routes['proxy/segment'](
        request('proxy/segment', 'http://192.168.1.20:8080/chunk.ts'),
      )
    ).status,
  ).toBeGreaterThanOrEqual(400);
  expect(nodeFetch).toHaveBeenCalledTimes(1);
  nodeFetch.mockClear();
  process.env.LIVE_PROXY_TRUSTED_ORIGINS = JSON.stringify({
    live: ['http://169.254.169.254'],
  });
  expect(
    (
      await routes['proxy/segment'](
        request('proxy/segment', 'http://169.254.169.254/latest/meta-data'),
      )
    ).status,
  ).toBeGreaterThanOrEqual(400);
  expect(nodeFetch).not.toHaveBeenCalled();
});

test('stream range and cancellation are preserved and oversized images stop reading', async () => {
  nodeFetch.mockResolvedValueOnce(
    reply('part', 'video/mp2t', 206, { 'content-range': 'bytes 0-3/20' }),
  );
  const response = await routes['proxy/segment'](
    request('proxy/segment', undefined, { headers: { range: 'bytes=0-3' } }),
  );
  expect(response.status).toBe(206);
  expect(response.headers.get('content-range')).toBe('bytes 0-3/20');
  expect(nodeFetch.mock.calls[0][1].headers.range).toBe('bytes=0-3');
  await response.text();
  const upstream = reply('x'.repeat(10 * 1024 * 1024 + 1));
  nodeFetch.mockResolvedValueOnce(upstream);
  const image = await routes['image-proxy'](request('image-proxy'));
  await expect(image.arrayBuffer()).rejects.toThrow('size limit');
  expect(upstream.body.destroyed).toBe(true);
});

test('live m3u8 passthrough keeps continuous non-playlist streams above 5 MiB flowing', async () => {
  nodeFetch.mockResolvedValueOnce(
    reply('x'.repeat(6 * 1024 * 1024), 'video/mp2t'),
  );
  const response = await routes['proxy/m3u8'](
    request('proxy/m3u8', 'https://cdn.example/live'),
  );
  expect(response.status).toBe(200);
  expect((await response.arrayBuffer()).byteLength).toBe(6 * 1024 * 1024);
});

test('cancelling a downstream live stream destroys its upstream transport', async () => {
  const upstream = new Readable({ read() {} });
  nodeFetch.mockResolvedValueOnce({ ...reply(), body: upstream });
  const response = await routes['proxy/segment'](request('proxy/segment'));
  await response.body.cancel();
  expect(upstream.destroyed).toBe(true);
});

test('a stalled live response aborts its upstream after the idle timeout', async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  try {
    const upstream = new Readable({ read() {} });
    nodeFetch.mockResolvedValueOnce({ ...reply(), body: upstream });
    const response = await routes['proxy/segment'](request('proxy/segment'));
    const reading = response.text();
    const rejected = expect(reading).rejects.toThrow(/aborted|timed out/);
    await jest.advanceTimersByTimeAsync(30_001);
    await rejected;
    expect(upstream.destroyed).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});
