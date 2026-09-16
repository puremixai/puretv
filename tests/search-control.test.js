/** @jest-environment node */
Object.assign(
  global,
  require('vm').runInThisContext(
    '({fetch,Request,Response,Headers,AbortController,AbortSignal,DOMException,ReadableStream})'
  )
);
const http = require('node:http');
const {
  SearchSemaphore,
  fetchSearchResponse,
  mapSearchTasks,
} = require('../src/lib/server/search-control');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('source work is bounded and retains result order', async () => {
  let active = 0,
    peak = 0;
  const results = await mapSearchTasks(
    [1, 2, 3, 4, 5, 6],
    new AbortController().signal,
    async (item) => {
      peak = Math.max(peak, ++active);
      await delay(5);
      active--;
      return item * 2;
    },
    2
  );
  expect(peak).toBe(2);
  expect(results).toEqual([2, 4, 6, 8, 10, 12]);
});

test('queued cancellation never starts work or leaks a permit', async () => {
  const pool = new SearchSemaphore(1, 1);
  let release;
  const first = pool.run(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  await Promise.resolve();
  const controller = new AbortController();
  const task = jest.fn();
  const pending = pool.run(task, controller.signal);
  await expect(pool.run(task)).rejects.toThrow('搜索繁忙');
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  release();
  await first;
  expect(task).not.toHaveBeenCalled();
  await expect(
    pool.run(async () => {
      throw new Error('upstream');
    })
  ).rejects.toThrow('upstream');
  await expect(pool.run(async () => 'recovered')).resolves.toBe('recovered');
});

describe('real HTTP response lifecycle', () => {
  let server, url, closed, arrived, sockets;
  beforeEach(async () => {
    sockets = new Set();
    closed = false;
    server = http.createServer((req, res) => {
      res.on('close', () => {
        closed = true;
      });
      if (req.url === '/large') {
        res.writeHead(200, { 'Content-Length': 9 * 1024 * 1024 });
        res.flushHeaders();
      } else if (req.url === '/ok') res.end('{"ok":true}');
      else {
        res.writeHead(200);
        res.write('{');
      }
      arrived?.();
    });
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}`;
  });
  afterEach(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  test('deadline includes a stalled body after successful headers', async () => {
    const started = Date.now();
    await expect(fetchSearchResponse(url, {}, 100)).rejects.toMatchObject({
      name: expect.stringMatching(/AbortError|TimeoutError/),
    });
    expect(Date.now() - started).toBeLessThan(1500);
    await delay(30);
    expect(closed).toBe(true);
    expect(await (await fetchSearchResponse(url + '/ok')).json()).toEqual({
      ok: true,
    });
  });
  test('caller cancellation closes an upstream response being read', async () => {
    const controller = new AbortController();
    const headers = new Promise((resolve) => {
      arrived = resolve;
    });
    const pending = fetchSearchResponse(url, { signal: controller.signal });
    await headers;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await delay(30);
    expect(closed).toBe(true);
  });
  test('oversized bodies are rejected and disconnected', async () => {
    await expect(fetchSearchResponse(url + '/large')).rejects.toThrow(
      '搜索响应过大'
    );
    await delay(30);
    expect(closed).toBe(true);
  });
});
