/** @jest-environment node */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const projectRoot = path.resolve(__dirname, '..');

async function readServerOptions(env) {
  const filename = path.join(projectRoot, 'server.js');
  const projectRequire = createRequire(filename);
  // Keep real startup option selection, but stop before any listener or database.
  const prepare = jest.fn(() => new Promise(() => {}));
  const next = jest.fn(() => ({
    prepare,
    getRequestHandler: () => () => {},
  }));
  const createServer = jest.fn(() => {
    throw new Error('This test must not start an HTTP server');
  });
  const testProcess = {
    env: { ...env },
    platform: process.platform,
    cwd: () => projectRoot,
    on: jest.fn(),
    exit: jest.fn(),
  };
  vm.runInNewContext(
    fs.readFileSync(filename, 'utf8'),
    {
      require: (name) => {
        if (name === 'next') return next;
        if (name === 'http' || name === 'node:http') return { createServer };
        if (name === './scripts/load-env') return { loadAppEnv: () => {} };
        return projectRequire(name);
      },
      __dirname: projectRoot,
      __filename: filename,
      process: testProcess,
      console,
    },
    { filename, timeout: 1000 }
  );
  await Promise.resolve();
  expect(next).toHaveBeenCalledTimes(1);
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(createServer).not.toHaveBeenCalled();
  expect(testProcess.exit).not.toHaveBeenCalled();
  return next.mock.calls[0][0];
}

test.each([undefined, 'development', 'production'])(
  'custom server defaults to Webpack with NODE_ENV=%s',
  async (nodeEnv) => {
    const options = await readServerOptions({ NODE_ENV: nodeEnv });
    expect(options.webpack).toBe(true);
    expect(options.turbopack).not.toBe(true);
    expect(options.dev).toBe(nodeEnv !== 'production');
  }
);

test.each(['development', 'production'])(
  'custom server honors explicit Turbopack selection in %s',
  async (nodeEnv) => {
    const options = await readServerOptions({
      NODE_ENV: nodeEnv,
      PURETV_BUNDLER: 'turbopack',
    });
    expect(options.turbopack).toBe(true);
    expect(options.webpack).not.toBe(true);
  }
);

test.each([
  { BUILD_TARGET: 'cloudflare' },
  { BUILD_TARGET: 'edgeone' },
  { CF_PAGES: '1' },
  { EDGEONE_PAGES: '1' },
])(
  'edge environment %j keeps Webpack even when Turbopack is requested',
  async (edgeEnv) => {
    const options = await readServerOptions({
      NODE_ENV: 'production',
      PURETV_BUNDLER: 'turbopack',
      ...edgeEnv,
    });
    expect(options.webpack).toBe(true);
    expect(options.turbopack).not.toBe(true);
  }
);

test('production Webpack configuration preserves the main entry without next-pwa registration injection', async () => {
  const filename = path.join(projectRoot, 'next.config.js');
  const configModule = { exports: {} };
  const projectRequire = createRequire(filename);
  const logOutput = jest.spyOn(console, 'log').mockImplementation(() => {});

  try {
    vm.runInNewContext(
      fs.readFileSync(filename, 'utf8'),
      {
        module: configModule,
        exports: configModule.exports,
        require: projectRequire,
        __dirname: projectRoot,
        __filename: filename,
        process: {
          env: { NODE_ENV: 'production' },
          platform: process.platform,
        },
        console,
      },
      { filename, timeout: 1000 }
    );
    const { PHASE_PRODUCTION_BUILD } = projectRequire('next/constants');
    const nextConfig = configModule.exports(PHASE_PRODUCTION_BUILD);
    const input = {
      module: {
        rules: [{ test: /\.(png|jpg|svg)$/i, type: 'asset/resource' }],
      },
      resolve: { fallback: {} },
      plugins: [],
      entry: async () => ({
        'main.js': ['./next-client.js', './app-entry.js'],
      }),
    };
    const configured = nextConfig.webpack(input, {
      isServer: true,
      dev: false,
      dir: projectRoot,
      buildId: 'bundler-test',
      config: nextConfig,
      webpack: {
        DefinePlugin: class DefinePlugin {
          constructor(definitions) {
            this.definitions = definitions;
          }
        },
      },
    });

    expect((await configured.entry())['main.js']).toEqual([
      './next-client.js',
      './app-entry.js',
    ]);
  } finally {
    logOutput.mockRestore();
  }
});
