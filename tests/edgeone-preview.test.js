/** @jest-environment node */
require('./web-globals');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createServer } = require('node:net');
const fetch = require('node:vm').runInThisContext('fetch');
const {
  fixture,
  patch,
  write,
  cleanup,
  previewScript,
} = require('./helpers/edgeone-fixture.cjs');

let root;
let child;
beforeEach(() => {
  root = fixture();
});
afterEach(async () => {
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await exited;
  }
  child = undefined;
  cleanup(root);
});

async function start(args = []) {
  const port = await new Promise((resolve) => {
    const reservation = createServer();
    reservation.listen(0, '127.0.0.1', () => {
      const port = reservation.address().port;
      reservation.close(() => resolve(port));
    });
  });
  child = spawn(process.execPath, [previewScript, ...args], {
    cwd: root,
    env: { ...process.env, PORT: String(port), PASSWORD: 'fixture-password' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(
      () => reject(new Error('Preview did not start: ' + output)),
      5000
    );
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/(?:127\.0\.0\.1|localhost):(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve({ origin: 'http://127.0.0.1:' + match[1], output });
      }
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

test('executes middleware before SSR and static assets, preserving authenticated POST bodies', async () => {
  expect(patch(root).status).toBe(0);
  write(root, '.edgeone/assets/private.html', '<p>private asset</p>');
  const { origin } = await start();
  expect((await fetch(origin + '/private')).status).toBe(401);
  expect((await fetch(origin + '/api/private')).status).toBe(401);
  const login = await fetch(origin + '/login');
  expect(login.status).toBe(200);
  expect((await login.json()).path).toBe('/login');
  const authenticated = await fetch(origin + '/api/private', {
    method: 'POST',
    headers: { cookie: 'session=valid' },
    body: 'preserved request body',
  });
  expect(authenticated.status).toBe(200);
  expect(authenticated.headers.get('x-test-middleware')).toBe('executed');
  expect(await authenticated.json()).toEqual({
    path: '/api/private',
    body: 'preserved request body',
  });
  const asset = await fetch(origin + '/private', {
    headers: { cookie: 'session=valid' },
  });
  expect(await asset.text()).toBe('<p>private asset</p>');
});

test('refuses to start an authentication preview without the generated middleware', async () => {
  fs.unlinkSync(path.join(root, '.edgeone/edge-functions/index.js'));
  const result = await start();
  expect(result.code).toBe(1);
  expect(result.output).toMatch(/middleware/i);
});

test('initializes SSR from its isolated artifact directory', async () => {
  write(
    root,
    '.edgeone/cloud-functions/ssr-node/handler.js',
    `export default async function handler() { return Response.json({ cwd: process.cwd() }); }`
  );
  expect(patch(root).status).toBe(0);
  const { origin } = await start();
  const response = await fetch(origin + '/login');
  expect(await response.json()).toEqual({
    cwd: path.join(root, '.edgeone/cloud-functions/ssr-node'),
  });
});

test.each(['gzip', 'deflate', 'br'])(
  'decodes %s origin responses before the generated middleware merges headers',
  async (encoding) => {
    write(
      root,
      '.edgeone/cloud-functions/ssr-node/handler.js',
      `import { gzipSync, deflateSync, brotliCompressSync } from 'node:zlib';
      const compress = { gzip: gzipSync, deflate: deflateSync, br: brotliCompressSync };
      export default async function handler() {
        const body = compress[${JSON.stringify(
          encoding
        )}](Buffer.from('<html><body>SSR page</body></html>'));
        return new Response(body, { headers: { 'content-type': 'text/html', 'content-encoding': ${JSON.stringify(
          encoding
        )}, 'content-length': String(body.length) } });
      }`
    );
    const file = path.join(root, '.edgeone/edge-functions/index.js');
    // The actual generated EdgeOne fetch listener removes encoding headers
    // after middleware runs, expecting a network Fetch response's decoded body.
    fs.writeFileSync(
      file,
      fs
        .readFileSync(file, 'utf8')
        .replace(
          "if (result) response.headers.set('x-test-middleware', result.headers.get('x-test-middleware'));",
          "if (result) { response.headers.delete('content-encoding'); response.headers.delete('content-length'); }"
        ),
      'utf8'
    );
    expect(patch(root).status).toBe(0);
    const { origin } = await start();
    for (const pathname of ['/login', '/private']) {
      const response = await fetch(origin + pathname, {
        headers: { cookie: 'session=valid' },
      });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('<html><body>SSR page</body></html>');
    }
  }
);

test('explicit SSR-only mode exposes that authentication is not being verified', async () => {
  fs.unlinkSync(path.join(root, '.edgeone/edge-functions/index.js'));
  const result = await start(['--ssr-only']);
  expect(result.output).toMatch(/authentication.*not.*verified/i);
  const response = await fetch(result.origin + '/private');
  expect(response.status).toBe(200);
  expect(response.headers.get('x-puretv-preview-mode')).toBe('ssr-only');
});
