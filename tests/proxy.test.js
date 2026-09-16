/** @jest-environment node */
require('./web-globals');
global.fetch = require('vm').runInThisContext('fetch');
const dns = require('dns');
const { Readable } = require('stream');
const { isPrivateIP, resolvePublicTarget } = require('../src/lib/server/ssrf');
const {
  fetchPublicUrl,
  readLimitedText,
} = require('../src/lib/server/public-fetch');
const nodeFetch = require('node-fetch');

jest.mock('node-fetch', () => jest.fn());
afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

test.each([
  '127.0.0.1',
  '10.0.0.1',
  '100.64.0.1',
  '169.254.169.254',
  '0.0.0.0',
  '192.168.1.1',
  '224.0.0.1',
  '::1',
  '::',
  'fe80::1',
  'fc00::1',
  '::ffff:127.0.0.1',
  '::ffff:7f00:1',
  '2002:7f00:1::',
  'not-an-ip',
])('blocks non-public address %s', (address) => {
  expect(isPrivateIP(address)).toBe(true);
});

test.each([
  '93.184.216.34',
  '8.8.8.8',
  '2606:4700:4700::1111',
  '::ffff:808:808',
])('accepts public address %s', (address) => {
  expect(isPrivateIP(address)).toBe(false);
});

test('normalizes abbreviated/hex IPs and rejects credentials or mixed public/private DNS answers', async () => {
  for (const url of [
    'http://127.1/',
    'http://0x7f000001/',
    'http://user:password@example.com/',
    'file:///etc/passwd',
  ]) {
    await expect(resolvePublicTarget(url)).rejects.toThrow();
  }
  jest.spyOn(dns.promises, 'lookup').mockResolvedValue([
    { address: '93.184.216.34', family: 4 },
    { address: '10.0.0.1', family: 4 },
  ]);
  await expect(resolvePublicTarget('https://example.com')).rejects.toThrow();
});

function reply(status, headers = {}, body = 'video') {
  return {
    status,
    statusText: 'OK',
    headers: new Headers(headers),
    body: Readable.from([Buffer.from(body)]),
  };
}

test('pins the validated DNS addresses to the transport and strips site credentials', async () => {
  const lookup = jest
    .spyOn(dns.promises, 'lookup')
    .mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  nodeFetch.mockResolvedValue(reply(200));
  const response = await fetchPublicUrl('https://example.com/video', {
    headers: {
      Cookie: 'secret',
      Authorization: 'Bearer secret',
      Range: 'bytes=0-3',
    },
  });
  expect(await response.text()).toBe('video');
  const options = nodeFetch.mock.calls[0][1];
  expect(options.redirect).toBe('manual');
  expect(options.headers.cookie).toBeUndefined();
  expect(options.headers.authorization).toBeUndefined();
  expect(options.headers.range).toBe('bytes=0-3');
  const callback = jest.fn();
  options.agent.options.lookup('example.com', { all: true }, callback);
  expect(callback).toHaveBeenCalledWith(null, [
    { address: '93.184.216.34', family: 4 },
  ]);
  expect(lookup).toHaveBeenCalledTimes(1);
});

test('revalidates every redirect and never fetches an internal redirect target', async () => {
  jest
    .spyOn(dns.promises, 'lookup')
    .mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  nodeFetch.mockResolvedValue(
    reply(302, { location: 'http://127.0.0.1/private' })
  );
  await expect(fetchPublicUrl('https://example.com/video')).rejects.toThrow();
  expect(nodeFetch).toHaveBeenCalledTimes(1);
});

test('preserves the final redirected URL for relative playlist rewriting', async () => {
  jest
    .spyOn(dns.promises, 'lookup')
    .mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  nodeFetch
    .mockResolvedValueOnce(reply(302, { location: '/media/list.m3u8' }))
    .mockResolvedValueOnce(reply(200, {}, '#EXTM3U'));
  const response = await fetchPublicUrl('https://example.com/start');
  expect(response.url).toBe('https://example.com/media/list.m3u8');
  expect(await readLimitedText(response)).toBe('#EXTM3U');
});

test('limits playlist memory consumption', async () => {
  await expect(readLimitedText(new Response('0123456789'), 5)).rejects.toThrow(
    'size limit'
  );
});


test('fake DNS answers are replaced with trusted public addresses, never allowed directly', async () => {
  jest.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '198.18.0.95', family: 4 }]);
  const doh = jest.spyOn(global, 'fetch').mockImplementation(async url => new Response(JSON.stringify({ Status: 0, Answer: url.endsWith('type=A') ? [{ type: 1, TTL: 0, data: '151.101.2.132' }] : [] })));
  const resolved = await resolvePublicTarget('https://fake-dns.example/video');
  expect(resolved.addresses).toEqual([{ address: '151.101.2.132', family: 4 }]);
  expect(doh).toHaveBeenCalledTimes(2);
  await expect(resolvePublicTarget('https://198.18.0.95/video')).rejects.toThrow();
});
test('private real-DNS answers and mixed fake/private OS answers remain blocked', async () => {
  const lookup = jest.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '198.18.1.5', family: 4 }]);
  const doh = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, TTL: 0, data: '127.0.0.1' }] })));
  await expect(resolvePublicTarget('https://private-real.example/video')).rejects.toThrow();
  doh.mockClear(); lookup.mockResolvedValue([{ address: '198.18.1.5', family: 4 }, { address: '10.0.0.1', family: 4 }]);
  await expect(resolvePublicTarget('https://mixed.example/video')).rejects.toThrow(); expect(doh).not.toHaveBeenCalled();
});
