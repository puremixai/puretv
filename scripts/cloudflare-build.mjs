#!/usr/bin/env node
import { createRequire } from 'node:module';
import * as nodeModule from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { patchBundleEntry } from './cloudflare-output-links.mjs';

process.env.BUILD_TARGET = 'cloudflare';
const require = createRequire(import.meta.url);
const cliRoot = path.resolve(
  path.dirname(require.resolve('@opennextjs/cloudflare')),
  '../cli'
);

if (process.platform === 'win32') {
  if (typeof nodeModule.registerHooks !== 'function') {
    throw new Error(
      'Windows Cloudflare builds require Node.js 22.15 or newer for output-link repair'
    );
  }
  const bundleURL = pathToFileURL(
    path.join(cliRoot, 'build/bundle-server.js')
  ).href;
  const helperURL = new URL('./cloudflare-output-links.mjs', import.meta.url)
    .href;
  let applied = false;
  nodeModule.registerHooks({
    load(url, context, nextLoad) {
      const result = nextLoad(url, context);
      if (url !== bundleURL) return result;
      const source =
        typeof result.source === 'string'
          ? result.source
          : Buffer.from(result.source).toString('utf8');
      applied = true;
      return { ...result, source: patchBundleEntry(source, helperURL) };
    },
  });
  process.on('exit', (code) => {
    if (code === 0 && !applied) {
      console.error(
        '[cloudflare-build] OpenNext bundleServer hook was not loaded'
      );
      process.exitCode = 1;
    }
  });
}

// Keep the official CLI build/argument handling on both platforms. The Windows
// hook changes only the copied output links immediately before final bundling.
process.argv = [
  process.argv[0],
  path.join(cliRoot, 'index.js'),
  'build',
  ...process.argv.slice(2),
];
await import(pathToFileURL(path.join(cliRoot, 'index.js')).href);
