const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const projectRoot = path.resolve(__dirname, '../..');
const nextCache = () => ({
  type: 'filesystem',
  name: 'server-production',
  cacheDirectory: 'fixture/cache',
  version: 'next-fingerprint',
});

function configureWebpack(env = {}, overrides = {}) {
  const filename = path.join(projectRoot, 'next.config.js');
  const projectRequire = createRequire(filename);
  const configModule = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(filename, 'utf8'),
    {
      module: configModule,
      exports: configModule.exports,
      require: projectRequire,
      __dirname: projectRoot,
      __filename: filename,
      process: {
        env: { NODE_ENV: 'production', ...env },
        platform: process.platform,
      },
      console,
    },
    { filename, timeout: 1000 }
  );
  const nextConfig = configModule.exports(
    projectRequire('next/constants').PHASE_PRODUCTION_BUILD
  );
  return nextConfig.webpack(
    {
      module: { rules: [] },
      resolve: { fallback: {} },
      plugins: [],
      cache: nextCache(),
      ...overrides,
    },
    { isServer: true, dev: false }
  );
}

function compile(options) {
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  return new Promise((resolve, reject) => {
    const compiler = webpack(options);
    compiler.run((error, stats) => {
      compiler.close((closeError) => {
        if (error || closeError) return reject(error || closeError);
        if (stats.hasErrors()) {
          return reject(
            new Error(stats.toString({ all: false, errors: true }))
          );
        }
        resolve(stats.toJson({ all: false, modules: true }));
      });
    });
  });
}

async function runCacheSequence({ edgeTarget, sharedCache = false }) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'puretv-webpack-cache-'));
  const entry = path.join(fixture, 'entry.js');
  const driver = path.join(fixture, 'native-driver.cjs');
  const output = path.join(fixture, 'output');
  const bundle = path.join(output, 'bundle.cjs');
  try {
    // Model a native package's CommonJS constructor without loading an addon.
    fs.writeFileSync(
      driver,
      'module.exports = class NativeDriver { constructor() { this.kind = "native-driver"; } };\n'
    );
    fs.writeFileSync(
      entry,
      'const Driver = require("better-sqlite3"); module.exports = () => typeof Driver === "function" ? new Driver().kind : typeof Driver.default === "function" ? "edge-shim" : "unexpected-export";\n'
    );
    const results = [];
    for (const target of [edgeTarget, 'node', edgeTarget]) {
      const configured = configureWebpack(
        { BUILD_TARGET: target },
        {
          cache: {
            ...nextCache(),
            cacheDirectory: path.join(fixture, 'cache'),
          },
          externals: [{ 'better-sqlite3': `commonjs ${driver}` }],
        }
      );
      if (sharedCache) {
        configured.cache.name = nextCache().name;
        configured.cache.version = nextCache().version;
      }
      const stats = await compile({
        mode: 'production',
        name: 'server',
        target: 'node',
        context: fixture,
        entry,
        output: {
          path: output,
          filename: 'bundle.cjs',
          library: { type: 'commonjs2' },
        },
        cache: configured.cache,
        resolve: configured.resolve,
        externals: configured.externals,
        module: { rules: [{ test: /\.ts$/, loader: __filename }] },
        optimization: { minimize: false },
      });
      const runtimeModule = { exports: {} };
      vm.runInNewContext(
        fs.readFileSync(bundle, 'utf8'),
        {
          module: runtimeModule,
          exports: runtimeModule.exports,
          require: createRequire(bundle),
          __dirname: output,
          __filename: bundle,
        },
        { filename: bundle, timeout: 1000 }
      );
      results.push({
        target,
        result: runtimeModule.exports(),
        cachedModules: (stats.modules || []).filter((module) => module.cached)
          .length,
        cacheName: configured.cache.name,
      });
    }
    return results;
  } finally {
    // Delete only the exact temporary directory allocated by this fixture.
    const resolved = path.resolve(fixture);
    if (
      path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
      !path.basename(resolved).startsWith('puretv-webpack-cache-')
    ) {
      throw new Error('Unexpected webpack fixture cleanup path');
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

// Webpack invokes this loader only for the real Edge shim's TypeScript source.
module.exports = function transpileFixtureTypeScript(source) {
  const ts = require('typescript');
  return ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
};
module.exports.configureWebpack = configureWebpack;
module.exports.nextCache = nextCache;
module.exports.runCacheSequence = runCacheSequence;
