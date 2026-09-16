#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');
const { generateSW } = require('workbox-build');
const {
  runtimeCaching,
  removeLegacyPrivateCaches,
} = require('./pwa-cache.cjs');

function normalizeScope(scope) {
  if (
    !scope.startsWith('/') ||
    scope.startsWith('//') ||
    /[\s\\?#]|%2f|%5c/i.test(scope) ||
    scope
      .split('/')
      .some((part) => ['.', '..'].includes(decodeURIComponent(part)))
  ) {
    throw new Error('PWA scope must be a root-relative directory');
  }
  return scope.endsWith('/') ? scope : scope + '/';
}

async function generatePwa({
  projectDir = path.resolve(__dirname, '..'),
  distDir = '.next',
  scope = process.env.NEXT_PUBLIC_BASE_PATH || '/',
  environment = process.env,
} = {}) {
  const edge =
    environment.CF_PAGES === '1' ||
    environment.EDGEONE_PAGES === '1' ||
    ['cloudflare', 'edgeone'].includes(environment.BUILD_TARGET);
  if (edge || environment.NODE_ENV === 'development')
    return { skipped: true, count: 0, size: 0, warnings: [] };
  const base = normalizeScope(scope);
  if (path.isAbsolute(distDir) || distDir.split(/[\\/]/).includes('..'))
    throw new Error('PWA distDir must stay within the project');
  const root = path.resolve(projectDir);
  const normalizedDist = distDir.replace(/\\/g, '/');
  await fs.access(path.join(root, normalizedDist, 'static'));
  await fs.access(path.join(root, 'public/push-sw.js'));
  const manifestPatterns = [];
  for (const name of ['manifest.json', 'manifest.webmanifest']) {
    try {
      await fs.access(path.join(root, 'public', name));
      manifestPatterns.push('public/' + name);
    } catch {
      // Deployments may use either manifest filename.
    }
  }
  const result = await generateSW({
    globDirectory: root,
    globPatterns: [
      'public/**/*.{js,css,png,jpg,jpeg,gif,webp,avif,svg,ico,eot,otf,ttf,woff,woff2,wasm}',
      ...manifestPatterns,
      normalizedDist +
        '/static/**/*.{js,css,png,jpg,jpeg,gif,webp,avif,svg,ico,eot,otf,ttf,woff,woff2,wasm}',
    ],
    globIgnores: [
      '**/*.map',
      'public/sw.js',
      'public/workbox-*.js',
      'public/push-sw.js',
      // Large subtitles and optional settings examples are loaded on demand.
      'public/assets/jassub/**',
      'public/scripts/bangumi-proxy.worker.js',
      'public/noprecache/**/*',
      'public/screenshot*.png',
    ],
    modifyURLPrefix: {
      'public/': base,
      [normalizedDist + '/static/']: base + '_next/static/',
    },
    swDest: path.join(root, 'public/sw.js'),
    importScripts: [base + 'push-sw.js'],
    maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
    dontCacheBustURLsMatching: /\/_next\/static\//,
    cleanupOutdatedCaches: true,
    clientsClaim: true,
    skipWaiting: true,
    inlineWorkboxRuntime: true,
    sourcemap: false,
    runtimeCaching,
  });
  await fs.appendFile(
    path.join(root, 'public/sw.js'),
    '\n(' + removeLegacyPrivateCaches.toString() + ')();\n',
    'utf8'
  );
  return { ...result, skipped: false };
}

if (require.main === module) {
  const rootArgument = process.argv.indexOf('--root');
  generatePwa(
    rootArgument >= 0 ? { projectDir: process.argv[rootArgument + 1] } : {}
  )
    .then((result) => {
      if (result.skipped)
        console.log('[PWA] Skipped for development or edge output.');
      else
        console.log(
          '[PWA] Generated sw.js: ' +
            result.count +
            ' static assets, ' +
            result.size +
            ' bytes.'
        );
      for (const warning of result.warnings) console.warn('[PWA] ' + warning);
    })
    .catch((error) => {
      console.error('[PWA] Generation failed:', error);
      process.exitCode = 1;
    });
}

module.exports = { generatePwa };
