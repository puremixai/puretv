/** @jest-environment node */
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { probeHealth } = require('../scripts/healthcheck.cjs');

let server;
afterEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  server = undefined;
});
async function listen(handler) {
  server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

test('checks the configured port and exact readiness endpoint', async () => {
  const paths = [];
  const port = await listen((request, response) => {
    paths.push(request.url);
    response.end('{"status":"degraded"}');
  });
  expect(await probeHealth({ port })).toBe(true);
  expect(paths).toEqual(['/api/health']);
});

test('reports an unavailable database response as unhealthy', async () => {
  const port = await listen((request, response) => {
    response.writeHead(503);
    response.end('{"status":"unavailable"}');
  });
  expect(await probeHealth({ port })).toBe(false);
});

test('terminates a stalled readiness request', async () => {
  const port = await listen(() => {});
  expect(await probeHealth({ port, timeoutMs: 30 })).toBe(false);
});

test('reports connection errors and invalid port configuration', async () => {
  const port = await listen(() => {});
  await new Promise((resolve) => server.close(resolve));
  server = undefined;
  expect(await probeHealth({ port })).toBe(false);
  expect(await probeHealth({ port: 'bad' })).toBe(false);
});

test('the CLI exits after readiness headers even when the response body never completes', async () => {
  const port = await listen((request, response) => {
    response.writeHead(200);
    response.flushHeaders();
  });
  const child = spawn(
    process.execPath,
    [path.resolve('scripts/healthcheck.cjs')],
    {
      env: { ...process.env, PORT: String(port) },
      stdio: 'ignore',
    },
  );
  let timer;
  try {
    const result = await Promise.race([
      new Promise((resolve) =>
        child.once('exit', (code, signal) => resolve({ code, signal })),
      ),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve('still-running'), 1500);
      }),
    ]);
    expect(result).toEqual({ code: 0, signal: null });
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill();
    server.closeAllConnections();
  }
});
