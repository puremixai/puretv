#!/usr/bin/env node
import { spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  patchMiddlewareCode,
  readMiddlewareMatchers,
} from './edgeone-middleware-patch.mjs';

function loadLocalEnvFile() {
  const envPath = join(process.cwd(), '.env');
  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) {
      continue;
    }

    let value = match[2].trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1);
    }
    if (quote === '"') {
      value = value
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }

    process.env[match[1]] = value;
  }
}

loadLocalEnvFile();

const runtimeEnvKeys = [
  'USERNAME',
  'PASSWORD',
  'AUTH_SECRET',
  'NEXT_PUBLIC_STORAGE_TYPE',
  'UPSTASH_URL',
  'UPSTASH_TOKEN',
  'TURSO_URL',
  'TURSO_TOKEN',
  'TMDB_API_KEY',
  'TMDB_IMAGE_DOMAIN',
  'NEXT_PUBLIC_SITE_NAME',
  'ANNOUNCEMENT',
  'ENABLE_REGISTER',
  'NEXT_PUBLIC_SEARCH_MAX_PAGE',
  'NEXT_PUBLIC_DOUBAN_PROXY_TYPE',
  'NEXT_PUBLIC_DOUBAN_PROXY',
  'NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE',
  'NEXT_PUBLIC_DOUBAN_IMAGE_PROXY',
  'NEXT_PUBLIC_ENABLE_OFFLINE_DOWNLOAD',
  'NEXT_PUBLIC_IMAGE_PROXY',
  'NEXT_PUBLIC_IMAGE_PROXY_PREFIX',
  'NEXT_PUBLIC_DISABLE_YELLOW_FILTER',
  'DISABLE_USER_FOLDER',
  'NEXT_PUBLIC_STORAGE_PREFIX',
  'NEXT_PUBLIC_ENABLE_STREAM_PROXY',
  'NEXT_PUBLIC_STREAM_PROXY_URL',
  'NEXT_PUBLIC_ENABLE_TURNSTILE',
  'TURNSTILE_SECRET_KEY',
  'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
  'NEXT_PUBLIC_THEME',
  'NEXT_PUBLIC_THEME_COLOR',
  'NEXT_PUBLIC_APP_URL',
  'ENABLE_TVBOX_SUBSCRIBE',
  'TVBOX_SUBSCRIBE_PATH',
  'TVBOX_SUBSCRIBE_TOKEN',
  'WATCH_ROOM_ENABLED',
  'WATCH_ROOM_WS_URL',
  'WATCH_ROOM_SERVER_URL',
  'WEBSOCKET_SECRET',
  'WEB_PUSH_EMAIL',
  'WEB_PUSH_PRIVATE_KEY',
  'WEB_PUSH_PUBLIC_KEY',
  'WEB_PUSH_BASEURL',
  'NEXT_PUBLIC_BASE_PATH',
];

function getRuntimeEnvLiteral() {
  const env = {};
  for (const key of runtimeEnvKeys) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }
  return JSON.stringify(env);
}

function replaceEnvLiterals(code, envLiteral) {
  let output = '';
  let cursor = 0;
  let replaced = 0;
  const needle = 'env: {';

  while (true) {
    const start = code.indexOf(needle, cursor);
    if (start === -1) {
      output += code.slice(cursor);
      break;
    }

    let i = start + 'env: '.length;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (; i < code.length; i += 1) {
      const char = code[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          i += 1;
          break;
        }
      }
    }

    if (depth !== 0) {
      throw new Error('Required middleware environment literal is malformed');
    }

    output += code.slice(cursor, start) + `env: ${envLiteral}`;
    cursor = i;
    replaced += 1;
  }

  if (replaced === 0)
    throw new Error('Required edge-function environment literal was not found');
  if (replaced > 0) {
    console.log(
      `[edgeone-build] Replaced ${replaced} generated env literal(s) with filtered runtime env`
    );
  }

  return output;
}

function patchEdgeFunctionEnvInjection() {
  const edgeFunctionPath = join(
    process.cwd(),
    '.edgeone',
    'edge-functions',
    'index.js'
  );
  const original = readFileSync(edgeFunctionPath, 'utf8');
  const matchers = readMiddlewareMatchers(process.cwd());
  const patched = patchMiddlewareCode(original, matchers);
  const code = replaceEnvLiterals(patched, getRuntimeEnvLiteral());
  writeFileSync(edgeFunctionPath, code);
  console.log(
    '[edgeone-build] Patched required middleware environment and manifest matcher'
  );
}

function patchEdgeFunctionMiddlewareConfig() {
  const configPath = join(
    process.cwd(),
    '.edgeone',
    'edge-functions',
    'config.json'
  );
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  readMiddlewareMatchers(process.cwd());
  if (config.middleware?.runtime && config.middleware.runtime !== 'edge') {
    throw new Error(
      'Unsupported edge-function middleware runtime: ' +
        config.middleware.runtime
    );
  }
  config.routes = Array.isArray(config.routes) ? config.routes : [];
  // Intercept all requests on the platform; exact manifest regexps run inside
  // the edge function before authentication. Complex Next regexps cannot be
  // represented by the platform path-to-regexp matcher without broadening them.
  config.middleware = {
    ...config.middleware,
    runtime: 'edge',
    matcher: [{ source: '/:path*' }],
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log('[edgeone-build] Patched edge-functions middleware interception');
}

/**
 * Fix /api returning HTTP 404 while body is correct and function logs show 200.
 *
 * EdgeOne route model:
 * - rules before { handle: "filesystem" } = preprocess
 * - filesystem tries static assets first (miss often becomes 404)
 * - rules after filesystem = SSR / API back-to-origin
 *
 * If /api is not explicitly listed after filesystem, static miss 404 can leak to
 * the client even when ssr-node successfully returns 200 + body.
 *
 * @see https://pages.edgeone.ai/document/building-output-configuration
 */
function isApiRouteRule(route) {
  if (!route || typeof route.src !== 'string') {
    return false;
  }
  return (
    route.src === '^/api/(.*)$' ||
    route.src === '^/api(?:/.*)?$' ||
    route.src === '^/api$' ||
    route.src === '/api/(.*)' ||
    route.src === '/api/*'
  );
}

function isCatchAllRoute(route) {
  if (!route || typeof route.src !== 'string') {
    return false;
  }
  return (
    route.src === '/.*' ||
    route.src === '^/.*$' ||
    route.src === '^(.*)$' ||
    route.src === '/(.*)'
  );
}

function patchSsrNodeRoutes() {
  const configPath = join(
    process.cwd(),
    '.edgeone',
    'cloud-functions',
    'ssr-node',
    'config.json'
  );

  const config = JSON.parse(readFileSync(configPath, 'utf8'));

  const originalRoutes = Array.isArray(config.routes) ? config.routes : [];
  // Drop previous patches / weak API rules; keep other generated rules.
  const routes = originalRoutes.filter(
    (route) => !isApiRouteRule(route) && !isCatchAllRoute(route)
  );

  let filesystemIdx = routes.findIndex(
    (route) => route && route.handle === 'filesystem'
  );
  if (filesystemIdx === -1) {
    routes.push({ handle: 'filesystem' });
    filesystemIdx = routes.length - 1;
    console.log(
      '[edgeone-build] Inserted missing { handle: "filesystem" } into ssr-node routes'
    );
  }

  const before = routes.slice(0, filesystemIdx + 1);
  const after = routes
    .slice(filesystemIdx + 1)
    .filter((route) => !isCatchAllRoute(route));

  // Official full-stack pattern: API + catch-all AFTER filesystem → Node SSR handler.
  // Do not write private fields into config.json — EdgeOne may reject unknown keys.
  const apiRoute = {
    src: '^/api(?:/.*)?$',
    dest: '/api',
  };
  const apiRouteWithCapture = {
    src: '^/api/(.*)$',
    dest: '/api/$1',
  };
  const catchAll = {
    src: '/.*',
  };

  // Short-circuit /api BEFORE filesystem so static layer never owns the request.
  // Avoids "static miss 404 status + SSR body" composites on some EdgeOne builds.
  const apiBeforeFilesystem = {
    src: '^/api(?:/.*)?$',
    dest: '/api',
  };

  const preFilesystem = before
    .slice(0, -1)
    .filter((route) => !isApiRouteRule(route));
  const filesystemRule = before[before.length - 1];

  config.version = config.version || 3;
  config.routes = [
    ...preFilesystem,
    apiBeforeFilesystem,
    filesystemRule,
    apiRouteWithCapture,
    apiRoute,
    ...after,
    catchAll,
  ];

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log(
    '[edgeone-build] Patched ssr-node routes: /api forced before+after filesystem (fix API 404 status leak)'
  );
}

/**
 * Wrap ssr-node handler so Response.status is never dropped if the runtime
 * re-constructs the response without status (defensive).
 */
function patchHandlerFile(handlerPath, code) {
  const marker = '/* edgeone-api-status-guard */';
  if (code.includes(marker)) {
    console.log(
      '[edgeone-build] ssr-node handler status guard already present'
    );
    return;
  }

  const guard = `
${marker}
function __edgeoneEnsureResponseStatus(response, fallbackStatus) {
  if (!response) return response;
  try {
    const status = Number(response.status || fallbackStatus || 200);
    if (status >= 100 && status <= 599 && response.status === status) {
      return response;
    }
    if (typeof Response !== 'undefined' && (response instanceof Response || typeof response.headers?.get === 'function')) {
      const headers = new Headers(response.headers || {});
      return new Response(response.body, {
        status: status >= 100 && status <= 599 ? status : 200,
        statusText: response.statusText,
        headers,
      });
    }
  } catch (_) {
    // ignore
  }
  return response;
}

function __edgeoneWrapHandler(fn) {
  if (typeof fn !== 'function') return fn;
  return async function __edgeonePatchedHandler(request, context) {
    const response = await fn(request, context);
    return __edgeoneEnsureResponseStatus(response, 200);
  };
}
`;

  let patched = code;
  let applied = false;

  if (/export\s+default\s+/.test(patched) && !applied) {
    patched = `${guard}\n${patched.replace(
      /export\s+default\s+/,
      'const __edgeoneOriginalDefault = '
    )}\nexport default __edgeoneWrapHandler(__edgeoneOriginalDefault);\n`;
    applied = true;
  }

  if (!applied && /module\.exports\s*=/.test(patched)) {
    patched = `${guard}\n${patched}\n;module.exports = __edgeoneWrapHandler(module.exports?.default || module.exports);\nif (module.exports && module.exports.default) { module.exports.default = __edgeoneWrapHandler(module.exports.default); }\n`;
    applied = true;
  }

  if (!applied && /exports\.default\s*=/.test(patched)) {
    patched = `${guard}\n${patched}\n;exports.default = __edgeoneWrapHandler(exports.default);\n`;
    applied = true;
  }

  if (!applied) {
    throw new Error(
      'Required ssr-node handler export has an unknown module shape'
    );
  }

  writeFileSync(handlerPath, patched);
  console.log(
    `[edgeone-build] Patched ssr-node handler status guard: ${handlerPath}`
  );
}

function patchSsrNodeHandlerStatus() {
  const candidates = [
    join(
      process.cwd(),
      '.edgeone',
      'cloud-functions',
      'ssr-node',
      'handler.js'
    ),
    join(process.cwd(), '.edgeone', 'cloud-functions', 'ssr-node', 'index.js'),
    join(process.cwd(), '.edgeone', 'cloud-functions', 'ssr-node', 'index.mjs'),
    join(
      process.cwd(),
      '.edgeone',
      'cloud-functions',
      'ssr-node',
      'handler.mjs'
    ),
  ];

  const handlerPath = candidates.find((candidate) => existsSync(candidate));
  if (!handlerPath) throw new Error('Required ssr-node handler was not found');
  patchHandlerFile(handlerPath, readFileSync(handlerPath, 'utf8'));
}

export function patchEdgeOneOutput() {
  for (const file of ['edgeone.json', 'package.json']) {
    copyFileSync(
      join(process.cwd(), file),
      join(process.cwd(), '.edgeone', file)
    );
  }
  patchEdgeFunctionEnvInjection();
  patchEdgeFunctionMiddlewareConfig();
  patchSsrNodeRoutes();
  patchSsrNodeHandlerStatus();
  for (const envPath of [
    join(process.cwd(), '.edgeone', '.env'),
    join(process.cwd(), '.edgeone', 'cloud-functions', 'ssr-node', '.env'),
  ])
    rmSync(envPath, { force: true });
}

function finishBuild(code, signal, patchOutput = true) {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  if (code !== 0 || !patchOutput) {
    process.exitCode = code ?? 1;
    return;
  }
  try {
    patchEdgeOneOutput();
  } catch (error) {
    console.error('[edgeone-build]', error.message);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.includes('--patch-only')) {
    finishBuild(0);
  } else {
    const tsconfigPath = join(process.cwd(), 'tsconfig.json');
    const originalTsconfig = existsSync(tsconfigPath)
      ? readFileSync(tsconfigPath)
      : null;
    const isInsideEdgeOneBuilder =
      process.env.NEXT_PRIVATE_STANDALONE === 'true';
    const command = isInsideEdgeOneBuilder
      ? 'pnpm build'
      : 'edgeone makers build';
    let result;
    try {
      result = await new Promise((resolve, reject) => {
        const child = spawn(command, {
          stdio: 'inherit',
          shell: true,
          env: { ...process.env, BUILD_TARGET: 'edgeone', EDGEONE_PAGES: '1' },
        });
        child.once('error', reject);
        child.once('close', (code, signal) => resolve({ code, signal }));
      });
    } catch (error) {
      console.error('[edgeone-build]', error.message);
      process.exitCode = 1;
    } finally {
      // EdgeOne rewrites tsconfig in place. Preserve its exact original bytes
      // on both successful and failed nested builds or artifact generation.
      if (originalTsconfig !== null)
        writeFileSync(tsconfigPath, originalTsconfig);
    }
    // The adapter invokes the nested Next build before it emits .edgeone.
    // Only the outer adapter process can validate and patch those artifacts.
    if (result)
      finishBuild(result.code, result.signal, !isInsideEdgeOneBuilder);
  }
}
