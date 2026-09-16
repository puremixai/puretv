/** @jest-environment node */
require('./web-globals');
const {
  resolveLiveProxyMode,
  getLiveStreamType,
  buildLivePlaybackUrl,
  resolveLivePlayback,
} = require('../src/lib/live-playback');
const { rewriteMediaPlaylist } = require('../src/lib/server/rewrite-m3u8');
const originalFetch = global.fetch;
beforeEach(() => {
  global.fetch = jest.fn(() => {
    throw new Error('Unexpected server request');
  });
});
afterEach(() => {
  global.fetch = originalFetch;
});

test.each([undefined, null, '', 'invalid'])(
  'missing or invalid mode %j selects direct access',
  (mode) => {
    expect(resolveLiveProxyMode(mode)).toBe('direct');
  },
);

test.each(['direct', 'm3u8-only', 'full'])(
  'preserves explicit mode %s',
  (mode) => {
    expect(resolveLiveProxyMode(mode)).toBe(mode);
  },
);

test.each([
  ['https://cdn.example/live.M3U8?token=a%2Fb', 'm3u8'],
  ['https://cdn.example/live.flv?token=abc', 'flv'],
  ['https://cdn.example/live.mp4?next=playlist.m3u8', 'mp4'],
  ['https://cdn.example/live.webm#t=2', 'mp4'],
])(
  'known direct stream %s needs no PureTV media request',
  async (url, type) => {
    expect(getLiveStreamType(url)).toBe(type);
    expect(await resolveLivePlayback(url, { key: 'news' })).toEqual({
      url,
      type,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  },
);

test.each(['full', 'm3u8-only'])(
  'an explicit %s HLS URL retains its signature and source key',
  async (proxyMode) => {
    const raw = 'https://cdn.example/live.m3u8?token=a%2Fb%2Bc&expires=12';
    const result = await resolveLivePlayback(raw, {
      key: 'news & sports',
      proxyMode,
    });
    const url = new URL(result.url, 'https://puretv.example');
    expect(url.pathname).toBe('/api/proxy/m3u8');
    expect(url.searchParams.get('url')).toBe(raw);
    expect(url.searchParams.get('puretv-source')).toBe('news & sports');
    expect(url.searchParams.get('allowCORS')).toBe(
      proxyMode === 'm3u8-only' ? 'true' : null,
    );
    expect(result.type).toBe('m3u8');
    expect(global.fetch).not.toHaveBeenCalled();
  },
);

test.each(['full', 'm3u8-only', 'direct'])(
  'progressive streams keep their existing direct route in %s mode',
  async (proxyMode) => {
    const url = 'https://cdn.example/news.flv';
    expect(buildLivePlaybackUrl(url, { key: 'news', proxyMode })).toBe(url);
    expect(await resolveLivePlayback(url, { key: 'news', proxyMode })).toEqual({
      url,
      type: 'flv',
    });
  },
);

test('an extensionless source gets only a type probe and still plays directly', async () => {
  const raw = 'https://cdn.example/channel?id=42&sig=a%2Fb';
  global.fetch.mockResolvedValue(
    new Response(JSON.stringify({ success: true, type: 'flv' })),
  );
  expect(await resolveLivePlayback(raw, { key: 'news & sports' })).toEqual({
    url: raw,
    type: 'flv',
  });
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const request = new URL(
    global.fetch.mock.calls[0][0],
    'https://puretv.example',
  );
  expect(request.pathname).toBe('/api/live/precheck');
  expect(request.searchParams.get('url')).toBe(raw);
  expect(request.searchParams.get('puretv-source')).toBe('news & sports');
});

test('a failed or unsupported type probe never upgrades direct playback to proxy', async () => {
  for (const response of [
    new Response('', { status: 403 }),
    new Response(JSON.stringify({ success: true, type: 'unknown' })),
  ]) {
    global.fetch.mockResolvedValueOnce(response);
    await expect(
      resolveLivePlayback('https://cdn.example/channel', { key: 'news' }),
    ).rejects.toThrow();
  }
  expect(
    global.fetch.mock.calls.every(([url]) =>
      url.startsWith('/api/live/precheck?'),
    ),
  ).toBe(true);
});

test('a cancelled channel or line test cancels its format probe without proxy fallback', async () => {
  const controller = new AbortController();
  global.fetch.mockImplementation(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        expect(options.signal).toBe(controller.signal);
        options.signal.addEventListener('abort', () =>
          reject(new Error('cancelled')),
        );
      }),
  );
  const resolving = resolveLivePlayback(
    'https://cdn.example/channel',
    { key: 'news' },
    controller.signal,
  );
  controller.abort();
  await expect(resolving).rejects.toThrow('cancelled');
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('playlist-only mode preserves direct media, keys and init segments through child playlists', () => {
  const entry = new URL(
    buildLivePlaybackUrl('https://cdn.example/live.m3u8', {
      key: 'news',
      proxyMode: 'm3u8-only',
    }),
    'https://puretv.example',
  );
  const body = rewriteMediaPlaylist(
    '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="secret.key"\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\npart.ts\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nchild.m3u8',
    entry.searchParams.get('url'),
    {
      origin: entry.origin,
      source: entry.searchParams.get('puretv-source'),
      mode: 'live',
      proxySegments: entry.searchParams.get('allowCORS') !== 'true',
    },
  );
  expect(body).toContain('URI="https://cdn.example/secret.key"');
  expect(body).toContain('URI="https://cdn.example/init.mp4"');
  expect(body).toContain('\nhttps://cdn.example/part.ts');
  const child = new URL(body.split('\n').at(-1));
  expect(child.pathname).toBe('/api/proxy/m3u8');
  expect(child.searchParams.get('allowCORS')).toBe('true');
  expect(body).not.toContain('/api/proxy/segment');
});
