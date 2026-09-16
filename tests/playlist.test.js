/** @jest-environment node */
const { rewriteMediaPlaylist } = require('../src/lib/server/rewrite-m3u8');
const options = {
  origin: 'https://puretv.test',
  source: 'source & one',
  token: 'opaque-token',
  mode: 'ad-filter',
  proxySegments: true,
  adBlockEnabled: false,
};

test('rewrites variants, audio, subtitles, keys, maps and fragments with one credential each', () => {
  const input =
    '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/list.m3u8"\n#EXT-X-MEDIA:TYPE=SUBTITLES,URI="subs.m3u8"\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-PART:DURATION=0.5,URI="part.m4s"\n#EXT-X-STREAM-INF:BANDWIDTH=100\n\nvariant?sig=a%2Fb\n#EXTINF:5,\nsegment.ts?sig=a%2Fb';
  const output = rewriteMediaPlaylist(
    input,
    'https://cdn.test/new/master.m3u8',
    options
  );
  const urls = [...output.matchAll(/URI="([^"]+)"/g)].map((m) => m[1]);
  urls.push(...output.split('\n').filter((line) => line.startsWith('https:')));
  expect(urls).toHaveLength(7);
  for (const text of urls) {
    const url = new URL(text);
    expect(url.origin).toBe(options.origin);
    expect(url.searchParams.getAll('token')).toEqual(['opaque-token']);
    expect(url.searchParams.get('source')).toBe('source & one');
    expect(url.searchParams.get('url')).toMatch(/^https:\/\/cdn.test\/new\//);
  }
  expect(new URL(urls[5]).pathname).toBe('/api/proxy-m3u8');
  expect(new URL(urls[5]).searchParams.get('adblock')).toBe('false');
  expect(new URL(urls[6]).searchParams.get('url')).toBe(
    'https://cdn.test/new/segment.ts?sig=a%2Fb'
  );
});

test('keeps direct segments absolute, data keys intact and VOD variants on the correct endpoint', () => {
  const output = rewriteMediaPlaylist(
    '#EXTM3U\n#EXT-X-KEY:URI="data:application/octet-stream;base64,AAAA"\nclip.ts\nchild.m3u8',
    'https://cdn.test/path/master.m3u8',
    { ...options, mode: 'vod', proxySegments: false }
  );
  expect(output).toContain('URI="data:application/octet-stream;base64,AAAA"');
  expect(output).toContain('\nhttps://cdn.test/path/clip.ts\n');
  expect(output).toContain('/api/proxy/vod/m3u8?');
});
