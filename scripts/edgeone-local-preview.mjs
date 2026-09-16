#!/usr/bin/env node
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { createEdgeOneRuntime } from './edgeone-preview-runtime.mjs';

const root = process.cwd();
const assetsDir = path.join(root, '.edgeone', 'assets');
const handlerPath = path.join(
  root,
  '.edgeone',
  'cloud-functions',
  'ssr-node',
  'handler.js'
);
const defaultPort = Number(
  process.env.PORT || process.env.EDGEONE_LOCAL_PORT || 8088
);
const ssrOnly = process.argv.includes('--ssr-only');

function loadDotenv(file) {
  if (!existsSync(file)) return;
  const content = readFileSync(file, 'utf-8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
    const idx = normalized.indexOf('=');
    if (idx <= 0) continue;
    const key = normalized.slice(0, idx).trim();
    let value = normalized.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotenv(path.join(root, '.env'));
loadDotenv(path.join(root, '.env.local'));

process.env.NODE_ENV ||= 'production';
process.env.BUILD_TARGET = 'edgeone';
process.env.EDGEONE_PAGES = '1';

if (!existsSync(handlerPath)) {
  console.error('未找到 EdgeOne SSR handler：', handlerPath);
  console.error('请先运行：pnpm build:edgeone');
  process.exit(1);
}

// The generated adapter initializes Next with process.cwd(). Keep it on the
// deployed SSR artifact so preview never borrows the host checkout's .next.
process.chdir(path.dirname(handlerPath));
const { default: edgeoneHandler } = await import(
  pathToFileURL(handlerPath).href
);
if (typeof edgeoneHandler !== 'function')
  throw new Error('EdgeOne SSR handler export is not a function');
const runEdge = ssrOnly
  ? null
  : createEdgeOneRuntime(
      path.join(root, '.edgeone', 'edge-functions', 'index.js'),
      process.env
    );
if (ssrOnly)
  console.warn('EdgeOne SSR-only preview: authentication is NOT verified.');

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.jar': 'application/java-archive',
};

function safeAssetPath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  const relative = decoded.replace(/^\/+/, '') || 'index.html';
  const full = path.normalize(path.join(assetsDir, relative));
  if (full !== assetsDir && !full.startsWith(assetsDir + path.sep)) return null;
  if (existsSync(full) && statSync(full).isFile()) return full;
  if (existsSync(full + '.html') && statSync(full + '.html').isFile())
    return full + '.html';
  const indexFile = path.join(full, 'index.html');
  if (existsSync(indexFile) && statSync(indexFile).isFile()) return indexFile;
  return null;
}

function staticResponse(request, file) {
  const ext = path.extname(file).toLowerCase();
  const headers = new Headers({
    'content-type': mime[ext] || 'application/octet-stream',
  });
  if (new URL(request.url).pathname.startsWith('/_next/static/')) {
    headers.set('cache-control', 'public,max-age=31536000,immutable');
  }
  return new Response(
    request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(file)),
    { headers }
  );
}

function toFetchRequest(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    headers.set(
      key,
      Array.isArray(value) ? value.join(', ') : String(value ?? '')
    );
  }
  if (!headers.has('x-forwarded-proto'))
    headers.set('x-forwarded-proto', 'http');
  const origin = `http://${headers.get('host') || 'localhost'}`;
  return new Request(new URL(req.url || '/', origin), {
    method: req.method || 'GET',
    headers,
    body: ['GET', 'HEAD'].includes(req.method || 'GET') ? undefined : req,
    duplex: 'half',
  });
}

function toEdgeOneRequest(request) {
  const url = new URL(request.url);
  return {
    method: request.method,
    url: url.pathname + url.search,
    headers: Object.fromEntries(request.headers),
    body: request.body || undefined,
  };
}

async function sendFetchResponse(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const cookies = response.headers.getSetCookie?.();
  if (cookies?.length) res.setHeader('set-cookie', cookies);
  if (!response.body) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(Buffer.from(value))) {
        await new Promise((resolve) => res.once('drain', resolve));
      }
    }
    res.end();
  } catch (error) {
    res.destroy(error);
  }
}

const server = createServer(async (req, res) => {
  try {
    const request = toFetchRequest(req);
    const serveOrigin = async (nextRequest) => {
      const asset = ['GET', 'HEAD'].includes(nextRequest.method)
        ? safeAssetPath(new URL(nextRequest.url).pathname)
        : null;
      if (asset) return staticResponse(nextRequest, asset);
      return edgeoneHandler(toEdgeOneRequest(nextRequest), {
        env: process.env,
        waitUntil: (promise) =>
          Promise.resolve(promise).catch((err) =>
            console.error('[waitUntil]', err)
          ),
      });
    };
    const response = runEdge
      ? await runEdge(request, serveOrigin)
      : await serveOrigin(request);
    if (ssrOnly) response.headers.set('x-puretv-preview-mode', 'ssr-only');
    await sendFetchResponse(res, response);
  } catch (error) {
    console.error('[edgeone-local-preview]', error);
    res.statusCode = 500;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(
      error instanceof Error ? error.stack || error.message : String(error)
    );
  }
});

server.listen(defaultPort, '127.0.0.1', () => {
  const mode = ssrOnly
    ? 'SSR-only; authentication is NOT verified'
    : 'generated middleware enabled';
  console.log(
    `EdgeOne local preview (${mode}) running at http://127.0.0.1:${
      server.address().port
    }`
  );
});
