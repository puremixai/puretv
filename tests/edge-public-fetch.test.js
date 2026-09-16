/** @jest-environment node */
require('./web-globals');

global.fetch = require('vm').runInThisContext('fetch');
const { fetchPublicUrl } = require('../src/lib/server/edge-public-fetch');
const originalAllowedHosts = process.env.MEDIA_PROXY_ALLOWED_HOSTS;

beforeEach(() => {
  process.env.MEDIA_PROXY_ALLOWED_HOSTS = 'cdn.example, other.example';
  jest.spyOn(global, 'fetch').mockImplementation(() => {
    throw new Error('Unexpected transport request; actual network is forbidden');
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  if (originalAllowedHosts === undefined) delete process.env.MEDIA_PROXY_ALLOWED_HOSTS;
  else process.env.MEDIA_PROXY_ALLOWED_HOSTS = originalAllowedHosts;
});

function bodyResponse(chunks, headers = {}) {
  const cancel = jest.fn();
  const body = new ReadableStream({
    start(controller) {
      chunks.forEach((value) => controller.enqueue(new TextEncoder().encode(value)));
      controller.close();
    },
    cancel,
  });
  return { response: new Response(body, { headers }), cancel };
}

test('rejects a configured CONNECT proxy before touching the Edge transport', async () => {
  global.fetch.mockResolvedValue(new Response('image'));
  await expect(fetchPublicUrl('https://cdn.example/a', {}, {
    proxyUrl: 'http://proxy.example:8080',
  })).rejects.toThrow(/proxy.*unsupported|unsupported.*proxy/i);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('trusted LAN origins never expand the operator Edge hostname allowlist', async () => {
  await expect(fetchPublicUrl('http://192.168.1.2/a', {}, {
    trustedOrigins: ['http://192.168.1.2'],
  })).rejects.toThrow(/MEDIA_PROXY_ALLOWED_HOSTS/);
  expect(global.fetch).not.toHaveBeenCalled();
});

test.each(['http://user:secret@cdn.example/a', 'file://cdn.example/a', 'https://unlisted.example/a'])(
  'rejects disallowed URL %s before transport', async (url) => {
    await expect(fetchPublicUrl(url)).rejects.toThrow();
    expect(global.fetch).not.toHaveBeenCalled();
  },
);

test('strips credentials, drops cross-origin Referer and preserves the final playlist URL', async () => {
  global.fetch
    .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/next' } }))
    .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: 'https://other.example/list.m3u8' } }))
    .mockResolvedValueOnce(new Response('#EXTM3U', { headers: { 'set-cookie': 'upstream=secret' } }));
  const response = await fetchPublicUrl('https://cdn.example/start', {
    headers: { cookie: 'secret', authorization: 'secret', host: 'secret',
      'proxy-authorization': 'secret', referer: 'https://site.example/private', range: 'bytes=0-99' },
  });
  expect(await response.text()).toBe('#EXTM3U');
  const requests = global.fetch.mock.calls.map(([, options]) => options);
  requests.forEach((request) => {
    expect(request.redirect).toBe('manual');
    ['cookie', 'authorization', 'host', 'proxy-authorization'].forEach((name) =>
      expect(new Headers(request.headers).has(name)).toBe(false));
    expect(new Headers(request.headers).get('range')).toBe('bytes=0-99');
  });
  expect(new Headers(requests[1].headers).get('referer')).toBe('https://site.example/private');
  expect(new Headers(requests[2].headers).has('referer')).toBe(false);
  expect(response.headers.has('set-cookie')).toBe(false);
  expect(response.url).toBe('https://other.example/list.m3u8');
});

test('checks the allowlist again before following redirects', async () => {
  global.fetch.mockResolvedValueOnce(new Response(null, { status: 302,
    headers: { location: 'http://192.168.1.2/internal' } }));
  await expect(fetchPublicUrl('https://cdn.example/start')).rejects.toThrow(/MEDIA_PROXY_ALLOWED_HOSTS/);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('rejects an oversized Content-Length before streaming and cancels upstream', async () => {
  const cancel = jest.fn();
  global.fetch.mockResolvedValue(new Response(new ReadableStream({ cancel }), {
    headers: { 'content-length': '1024' },
  }));
  await expect(fetchPublicUrl('https://cdn.example/image', {}, { maxBytes: 8 })).rejects.toThrow(/size limit/);
  expect(cancel).toHaveBeenCalled();
});

test('bounds chunked bodies even when Content-Length is missing or understated', async () => {
  for (const headers of [{}, { 'content-length': '1' }]) {
    global.fetch.mockResolvedValue(bodyResponse(['1234', '56789'], headers).response);
    const response = await fetchPublicUrl('https://cdn.example/image', {}, { maxBytes: 8 });
    await expect(response.text()).rejects.toThrow(/size limit/);
  }
});

test('keeps continuous streams uncapped unless a maxBytes policy is specified', async () => {
  global.fetch.mockResolvedValue(bodyResponse(['x'.repeat(6 * 1024 * 1024)]).response);
  const response = await fetchPublicUrl('https://cdn.example/live');
  expect((await response.arrayBuffer()).byteLength).toBe(6 * 1024 * 1024);
});

test('applies the header timeout even when the caller supplied an abort signal', async () => {
  jest.useFakeTimers();
  global.fetch.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));
  const pending = fetchPublicUrl('https://cdn.example/a', {
    signal: new AbortController().signal,
  }, { timeoutMs: 50 });
  const failure = expect(pending).rejects.toThrow(/abort|timed out/);
  await jest.advanceTimersByTimeAsync(51);
  await failure;
});

test('aborts and errors a stalled response body after its idle timeout', async () => {
  jest.useFakeTimers();
  const cancel = jest.fn();
  global.fetch.mockResolvedValue(new Response(new ReadableStream({ cancel })));
  const response = await fetchPublicUrl('https://cdn.example/a', {}, { timeoutMs: 50 });
  const failure = expect(response.text()).rejects.toThrow(/abort|timed out/);
  await jest.advanceTimersByTimeAsync(51);
  await failure;
  expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  expect(cancel).toHaveBeenCalled();
});

test('refreshes the idle timer while streaming instead of limiting total playback time', async () => {
  jest.useFakeTimers();
  global.fetch.mockResolvedValue(new Response(new ReadableStream({
    start(controller) {
      setTimeout(() => controller.enqueue(new TextEncoder().encode('first')), 40);
      setTimeout(() => controller.enqueue(new TextEncoder().encode('second')), 80);
      setTimeout(() => controller.close(), 120);
    },
  })));
  const response = await fetchPublicUrl('https://cdn.example/live', {}, { timeoutMs: 50 });
  const body = response.text();
  await jest.advanceTimersByTimeAsync(121);
  expect(await body).toBe('firstsecond');
  expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
});

test('downstream cancellation cancels the upstream stream and clears timers', async () => {
  jest.useFakeTimers();
  const cancel = jest.fn();
  global.fetch.mockResolvedValue(new Response(new ReadableStream({ cancel })));
  const response = await fetchPublicUrl('https://cdn.example/a');
  await response.body.cancel();
  expect(cancel).toHaveBeenCalled();
  expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});

test('caller abort cancels an in-flight response body without accepting a truncated result', async () => {
  const cancel = jest.fn();
  const controller = new AbortController();
  global.fetch.mockResolvedValue(new Response(new ReadableStream({ cancel })));
  const response = await fetchPublicUrl('https://cdn.example/a', { signal: controller.signal });
  const failure = expect(response.text()).rejects.toThrow(/abort/);
  controller.abort();
  await failure;
  expect(cancel).toHaveBeenCalled();
});
