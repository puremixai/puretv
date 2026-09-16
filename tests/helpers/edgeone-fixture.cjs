const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

const repository = path.resolve(__dirname, '../..');
const buildScript = path.join(repository, 'scripts/edgeone-build.mjs');
const previewScript = path.join(
  repository,
  'scripts/edgeone-local-preview.mjs'
);
const edgeoneRequire = createRequire(require.resolve('edgeone/package.json'));
const adapterRoot = path.dirname(
  edgeoneRequire.resolve('@edgeone/opennextjs-pages/package.json')
);
const wrapperURL = pathToFileURL(
  path.join(adapterRoot, 'dist/build/functions/middleware/wrapper.js')
).href;
// Use the installed adapter's real Webpack wrapper, with a controlled app handler.
const wrapper = execFileSync(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    `const { getEdgeOneWrapperCode } = await import(${JSON.stringify(
      wrapperURL
    )}); process.stdout.write(getEdgeOneWrapperCode());`,
  ],
  { encoding: 'utf8', cwd: repository }
);

function write(root, file, contents) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    typeof contents === 'string' ? contents : JSON.stringify(contents),
    'utf8'
  );
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'puretv-edgeone-'));
  write(root, 'package.json', { type: 'module' });
  write(root, 'edgeone.json', {});
  write(root, '.next/server/middleware-manifest.json', {
    middleware: {
      '/': {
        matchers: [
          {
            originalSource: '/((?!login|_next/static).*)',
            regexp: '^/((?!login|_next/static).*)$',
          },
        ],
      },
    },
  });
  write(root, '.edgeone/edge-functions/config.json', {
    routes: [],
    middleware: { runtime: 'edge' },
  });
  write(root, '.edgeone/cloud-functions/ssr-node/config.json', {
    routes: [{ handle: 'filesystem' }, { src: '/.*' }],
  });
  write(
    root,
    '.edgeone/cloud-functions/ssr-node/handler.js',
    `export default async function handler(request) {
    return new Response(JSON.stringify({ path: request.url, body: request.body ? await new Response(request.body).text() : null }), { headers: { 'content-type': 'application/json' } });
  }`
  );
  write(
    root,
    '.edgeone/edge-functions/index.js',
    `
const _ENTRIES = { 'middleware_src/middleware': {
  config: { matcher: ['/:path*'] },
  default: async ({request}) => ({ response:
    globalThis.process.env.PASSWORD !== 'fixture-password' ? new Response('missing runtime env', { status: 503 }) :
    request.headers.cookie === 'session=valid' ? new Response(null, { headers: { 'x-middleware-next': '1', 'x-test-middleware': 'executed' } }) :
    new Response('Unauthorized', { status: 401 })
  })
}};
${wrapper}
function usercode(event, hookCtx) {
  return (async function handleRequest(context) {
    let request = context.request;
    const result = await executeMiddleware({ request, env: {} });
    if (result && result.headers.get('x-middleware-next') !== '1') return result;
    const response = await hookCtx.fetch(request);
    if (result) response.headers.set('x-test-middleware', result.headers.get('x-test-middleware'));
    return response;
  })({ request: event.request, env: {}, waitUntil: event.waitUntil });
}
addEventListener('fetch', (event, hookCtx) => event.respondWith(usercode(event, hookCtx)));
`
  );
  return root;
}

function patch(root, env = {}) {
  return spawnSync(process.execPath, [buildScript, '--patch-only'], {
    cwd: root,
    env: { ...process.env, PASSWORD: 'fixture-password', ...env },
    encoding: 'utf8',
    timeout: 10000,
  });
}

function cleanup(root) {
  const resolved = path.resolve(root);
  const parent = path.resolve(os.tmpdir()) + path.sep;
  if (
    !resolved.startsWith(parent) ||
    !path.basename(resolved).startsWith('puretv-edgeone-')
  )
    throw new Error('Unsafe fixture cleanup path');
  fs.rmSync(resolved, { recursive: true, force: true });
}

module.exports = {
  fixture,
  patch,
  write,
  cleanup,
  buildScript,
  previewScript,
  repository,
};
