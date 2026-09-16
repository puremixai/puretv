/** @jest-environment node */
require('./web-globals');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const {
  fixture,
  patch,
  write,
  cleanup,
  buildScript,
} = require('./helpers/edgeone-fixture.cjs');
let root;
beforeEach(() => {
  root = fixture();
});
afterEach(() => cleanup(root));

test.each([
  '.next/server/middleware-manifest.json',
  '.edgeone/edge-functions/index.js',
  '.edgeone/edge-functions/config.json',
  '.edgeone/cloud-functions/ssr-node/handler.js',
])('fails the build when required artifact %s is missing', (file) => {
  fs.unlinkSync(path.join(root, file));
  const result = patch(root);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/middleware|handler|edge-function/i);
});

test('refuses invalid manifest regexps and unknown SSR handler exports', () => {
  const manifest = '.next/server/middleware-manifest.json';
  const original = fs.readFileSync(path.join(root, manifest), 'utf8');
  write(root, manifest, {
    middleware: { '/': { matchers: [{ regexp: '[' }] } },
  });
  expect(patch(root).status).toBe(1);
  write(root, manifest, original);
  write(
    root,
    '.edgeone/cloud-functions/ssr-node/handler.js',
    'export const config = {};'
  );
  expect(patch(root).status).toBe(1);
});

test('rejects an unrecognized middleware wrapper without changing its artifact', () => {
  const file = path.join(root, '.edgeone/edge-functions/index.js');
  const unknown = fs
    .readFileSync(file, 'utf8')
    .replace(
      'async function executeMiddleware({request})',
      'async function unknownMiddleware({request})'
    );
  fs.writeFileSync(file, unknown, 'utf8');
  expect(patch(root).status).toBe(1);
  expect(fs.readFileSync(file, 'utf8')).toBe(unknown);
});

test('repeated patching preserves auth and applies manifest exclusions with CRLF input', async () => {
  const file = path.join(root, '.edgeone/edge-functions/index.js');
  fs.writeFileSync(
    file,
    fs.readFileSync(file, 'utf8').replace(/\r?\n/g, '\r\n'),
    'utf8'
  );
  expect(patch(root).status).toBe(0);
  expect(patch(root).status).toBe(0);
  let listener;
  const context = {
    URL,
    Request,
    Response,
    Headers,
    console,
    process: { env: {} },
    addEventListener: (_type, callback) => {
      listener = callback;
    },
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  async function request(pathname, cookie) {
    let response;
    listener(
      {
        request: new Request('http://preview.test' + pathname, {
          headers: cookie ? { cookie } : {},
        }),
        waitUntil: () => {},
        respondWith: (value) => {
          response = value;
        },
      },
      {
        fetch: async () => new Response('SSR response'),
      }
    );
    return response;
  }
  expect((await request('/private')).status).toBe(401);
  expect((await request('/private', 'session=valid')).status).toBe(200);
  expect(await (await request('/login')).text()).toBe('SSR response');
});

test('migrates an existing legacy matcher patch without losing its authentication gate', async () => {
  const file = path.join(root, '.edgeone/edge-functions/index.js');
  const oldCode = fs.readFileSync(file, 'utf8').replace(
    'const middlewareFn = await getMiddleware();',
    `/* edgeone-middleware-matcher-fallback */
    const edgeOneMiddlewareSkipPaths = ['/login'];
    if (edgeOneMiddlewareSkipPaths.some((path) => pathname === path || pathname.startsWith(path))) { return null; }
    const middlewareFn = await getMiddleware();`
  );
  fs.writeFileSync(file, oldCode, 'utf8');
  expect(patch(root).status).toBe(0);
  expect(patch(root).status).toBe(0);
  const context = {
    URL,
    Request,
    Response,
    Headers,
    console,
    process: { env: {} },
    addEventListener: () => {},
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  const env = { PASSWORD: 'fixture-password' };
  expect(
    (
      await context.executeMiddleware({
        request: new Request('http://preview.test/private'),
        env,
      })
    ).status
  ).toBe(401);
  expect(
    await context.executeMiddleware({
      request: new Request('http://preview.test/login'),
      env,
    })
  ).toBeNull();
});

test.each(['fresh', 'legacy'])(
  'keeps runtime auth settings ahead of build defaults on %s output',
  async (shape) => {
    const file = path.join(root, '.edgeone/edge-functions/index.js');
    let code = fs
      .readFileSync(file, 'utf8')
      .replace("'fixture-password'", "'runtime-password'");
    if (shape === 'legacy') {
      code = code
        .replace(
          'let request = context.request;',
          'let request = context.request;\n/* edgeone-process-env-injected */\nif (globalThis.process?.env && context?.env) { Object.assign(globalThis.process.env, context.env); }'
        )
        .replace(
          'async function executeMiddleware({request}) {',
          'async function executeMiddleware({request, env}) {\n/* edgeone-middleware-env-injected */\nif (globalThis.process?.env && env) { Object.assign(globalThis.process.env, env); }'
        );
    }
    fs.writeFileSync(file, code, 'utf8');
    expect(patch(root, { AUTH_SECRET: 'build-secret' }).status).toBe(0);
    expect(patch(root, { AUTH_SECRET: 'build-secret' }).status).toBe(0);
    let listener;
    const context = {
      URL,
      Request,
      Response,
      Headers,
      console,
      process: {
        env: {
          PASSWORD: 'runtime-password',
          AUTH_SECRET: 'runtime-secret',
          USERNAME: 'runtime-owner',
        },
      },
      addEventListener: (_type, callback) => {
        listener = callback;
      },
    };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
    let response;
    listener(
      {
        request: new Request('http://preview.test/private', {
          headers: { cookie: 'session=valid' },
        }),
        waitUntil: () => {},
        respondWith: (value) => {
          response = value;
        },
      },
      { fetch: async () => new Response('SSR') }
    );
    expect((await response).status).toBe(200);
    expect(context.process.env).toMatchObject({
      PASSWORD: 'runtime-password',
      AUTH_SECRET: 'runtime-secret',
      USERNAME: 'runtime-owner',
    });
    const defaults = {
      URL,
      Request,
      Response,
      Headers,
      console,
      process: { env: {} },
      addEventListener: (_type, callback) => {
        listener = callback;
      },
    };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), defaults);
    listener(
      {
        request: new Request('http://preview.test/login'),
        waitUntil: () => {},
        respondWith: (value) => {
          response = value;
        },
      },
      { fetch: async () => new Response('SSR') }
    );
    expect((await response).status).toBe(200);
    expect(defaults.process.env.AUTH_SECRET).toBe('build-secret');
  }
);

test.each([0, 7])(
  'nested builder forwards exit %s without patching unfinished outer artifacts',
  (exitCode) => {
    const originalTsconfig = '{\n  "compilerOptions": { "strict": true }\n}\n';
    write(root, 'tsconfig.json', originalTsconfig);
    fs.unlinkSync(path.join(root, '.edgeone/edge-functions/index.js'));
    write(
      root,
      'fake-build.cjs',
      `require('fs').writeFileSync('invocation.json', JSON.stringify({ target: process.env.BUILD_TARGET, pages: process.env.EDGEONE_PAGES, args: process.argv.slice(2) })); require('fs').writeFileSync('tsconfig.json', '{"exclude":["edge-functions"]}'); process.exit(${exitCode});`
    );
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    if (process.platform === 'win32') {
      write(
        root,
        'bin/pnpm.cmd',
        `@echo off\r\n"${process.execPath}" "${path.join(
          root,
          'fake-build.cjs'
        )}" %*\r\n`
      );
    } else {
      write(
        root,
        'bin/pnpm',
        `#!/bin/sh\nexec '${process.execPath.replace(/'/g, "'\\''")}' '${path
          .join(root, 'fake-build.cjs')
          .replace(/'/g, "'\\''")}' "$@"\n`
      );
      fs.chmodSync(path.join(bin, 'pnpm'), 0o755);
    }
    const result = spawnSync(process.execPath, [buildScript], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: bin + path.delimiter + process.env.PATH,
        NEXT_PRIVATE_STANDALONE: 'true',
      },
      timeout: 10000,
    });
    expect(result.status).toBe(exitCode);
    expect(fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf8')).toBe(
      originalTsconfig
    );
    expect(
      JSON.parse(fs.readFileSync(path.join(root, 'invocation.json'), 'utf8'))
    ).toEqual({ target: 'edgeone', pages: '1', args: ['build'] });
  }
);
