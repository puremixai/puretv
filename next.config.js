/** @type {import('next').NextConfig} */
/* eslint-disable @typescript-eslint/no-var-requires */

const { PHASE_DEVELOPMENT_SERVER } = require('next/constants');
const path = require('path');

// 检测是否为边缘平台构建
const isCloudflare =
  process.env.CF_PAGES === '1' || process.env.BUILD_TARGET === 'cloudflare';
const isEdgeOne =
  process.env.EDGEONE_PAGES === '1' || process.env.BUILD_TARGET === 'edgeone';
const isEdgeBuild = isCloudflare || isEdgeOne;
const useTurbopack = !isEdgeBuild && process.env.PURETV_BUNDLER === 'turbopack';
const browserNodeFiles = [
  'src/lib/d1.db.ts',
  'src/lib/d1-adapter.ts',
  'src/lib/postgres.db.ts',
  'src/lib/postgres-adapter.ts',
  'src/lib/turso-adapter.ts',
];
const browserEmptyLoader = require.resolve(
  './scripts/browser-empty-loader.cjs'
);

const optimizedPackageImports = [
  '@dnd-kit/core',
  '@dnd-kit/modifiers',
  '@dnd-kit/sortable',
  '@dnd-kit/utilities',
  '@heroicons/react',
  'lucide-react',
  'react-icons',
];

const createNextConfig = (phase) => {
  const isDevelopment =
    phase === PHASE_DEVELOPMENT_SERVER ||
    process.env.NODE_ENV === 'development';

  const nextConfig = {
    // Cloudflare Pages 不支持 standalone，使用默认输出
    // Windows runs the custom server directly; standalone packaging is produced in Linux/Docker.
    output:
      isEdgeBuild || process.platform === 'win32' ? undefined : 'standalone',
    distDir: isDevelopment ? '.next-dev' : '.next',
    reactStrictMode: false,
    reactCompiler: { compilationMode: 'annotation' },
    turbopack: useTurbopack
      ? {
          root: __dirname,
          resolveAlias: Object.fromEntries(
            [
              'net',
              'tls',
              'crypto',
              'node:net',
              'node:tls',
              'node:crypto',
              'better-sqlite3',
              '@vercel/postgres',
              'pg',
              '@libsql/client',
            ].map((name) => [name, { browser: './scripts/browser-empty.cjs' }])
          ),
          rules: {
            '*.svg': [
              {
                condition: {
                  all: [{ not: 'foreign' }, { query: /[?&]url(?:&|$)/ }],
                },
                type: 'asset',
              },
              {
                condition: {
                  all: [
                    { not: 'foreign' },
                    { not: { query: /[?&]url(?:&|$)/ } },
                  ],
                },
                loaders: [
                  {
                    loader: '@svgr/webpack',
                    options: { dimensions: false, titleProp: true },
                  },
                ],
                as: '*.js',
              },
            ],
            ...Object.fromEntries(
              browserNodeFiles.map((filename) => [
                filename,
                {
                  condition: { all: ['browser', { not: 'foreign' }] },
                  loaders: [browserEmptyLoader],
                  as: '*.js',
                },
              ])
            ),
          },
        }
      : undefined,

    // OpenNext/esbuild 使用 workerd condition 解析依赖。
    // @libsql/* 等包有 workerd 专用入口（如 web.cjs），Next NFT 默认只追踪 node 入口，
    // 导致 .open-next 里缺少 web.cjs 并报 Could not resolve "@libsql/isomorphic-ws"。
    // 声明为 server external 后，OpenNext 会完整拷贝这些包并应用 workerd 导出。
    // 参见: https://opennext.js.org/cloudflare/howtos/workerd

    serverExternalPackages: [
      '@libsql/client',
      '@libsql/hrana-client',
      '@libsql/isomorphic-ws',
      '@libsql/isomorphic-fetch',
      'libsql',
    ],
    experimental: {
      optimizePackageImports: optimizedPackageImports,
      webpackBuildWorker: !isEdgeBuild,
    },

    // Uncoment to add domain whitelist
    images: {
      unoptimized: true,
      remotePatterns: [
        {
          protocol: 'https',
          hostname: '**',
        },
        {
          protocol: 'http',
          hostname: '**',
        },
      ],
    },

    webpack(config, { isServer }) {
      // Next's default cache fingerprint omits environment-dependent aliases.
      // Keep each deployment target's native/edge module graph in its own pack.
      if (config.cache && config.cache.type === 'filesystem') {
        const target = isCloudflare
          ? 'cloudflare'
          : isEdgeOne
          ? 'edgeone'
          : 'node';
        config.cache = {
          ...config.cache,
          name: `${
            config.cache.name || `${config.name}-${config.mode}`
          }-puretv-${target}`,
          version: `${config.cache.version || ''}|puretv-build-target=${target}`,
        };
      }

      // Grab the existing rule that handles SVG imports
      const fileLoaderRule = config.module.rules.find((rule) =>
        rule.test?.test?.('.svg')
      );

      config.module.rules.push(
        // Reapply the existing rule, but only for svg imports ending in ?url
        {
          ...fileLoaderRule,
          test: /\.svg$/i,
          resourceQuery: /url/, // *.svg?url
        },
        // Convert all other *.svg imports to React components
        {
          test: /\.svg$/i,
          issuer: { not: /\.(css|scss|sass)$/ },
          resourceQuery: { not: /url/ }, // exclude if *.svg?url
          loader: '@svgr/webpack',
          options: {
            dimensions: false,
            titleProp: true,
          },
        }
      );

      // Modify the file loader rule to ignore *.svg, since we have it handled now.
      if (fileLoaderRule) fileLoaderRule.exclude = /\.svg$/i;

      config.resolve.fallback = {
        ...config.resolve.fallback,
        net: false,
        tls: false,
        crypto: false,
      };

      // Cloudflare 使用 D1，不需要把 better-sqlite3 原生模块带入 Worker 产物。
      if (isEdgeBuild) {
        config.resolve.alias = {
          ...config.resolve.alias,
          '@/lib/cache-backend': path.resolve(
            __dirname,
            'src/lib/cloudflare-shims/cache-backend.ts'
          ),
          '@/lib/server/public-fetch': path.resolve(
            __dirname,
            'src/lib/server/edge-public-fetch.ts'
          ),
          '@/lib/server/ssrf': path.resolve(
            __dirname,
            'src/lib/server/edge-ssrf.ts'
          ),
          ...Object.fromEntries(
            [
              'better-sqlite3',
              'sharp',
              'nodemailer',
              'socket.io',
              'redis',
              '@vercel/postgres',
              'pg',
              'libsql',
              '@libsql/isomorphic-fetch',
              '@libsql/isomorphic-ws',
            ].map((pkg) => [
              pkg,
              path.resolve(
                __dirname,
                'src/lib/cloudflare-shims/node-unsupported.ts'
              ),
            ])
          ),
          // Cloudflare Workers 有原生 fetch；代理 Agent 在 Workers 中不可用。
          // 用轻量 shim 替换 node-fetch / https-proxy-agent，避免把 Node HTTP 栈打入 Worker。
          'node-fetch': path.resolve(
            __dirname,
            'src/lib/cloudflare-shims/node-fetch.ts'
          ),
          ...(isCloudflare
            ? {
                'https-proxy-agent': path.resolve(
                  __dirname,
                  'src/lib/cloudflare-shims/https-proxy-agent.ts'
                ),
              }
            : {}),
          // opencc-js 字典体积巨大（~1.9MB），仅客户端繁简转换需要。
          // server 构建用空实现 shim 替换，避免字典内联进 Worker；client 构建用真库。
          ...(isCloudflare && isServer
            ? {
                'opencc-js/t2cn': path.resolve(
                  __dirname,
                  'src/lib/cloudflare-shims/opencc-js.ts'
                ),
                'opencc-js': path.resolve(
                  __dirname,
                  'src/lib/cloudflare-shims/opencc-js.ts'
                ),
              }
            : {}),
        };
        config.externals = (config.externals || []).filter((external) => {
          return !(
            external &&
            typeof external === 'object' &&
            Object.prototype.hasOwnProperty.call(external, 'better-sqlite3')
          );
        });
      }

      // Exclude better-sqlite3, D1, Postgres, and Turso modules from client-side bundle
      if (!isServer) {
        // Match relative imports as well as the aliases below. The browser
        // facade must not traverse native database drivers under either bundler.
        config.module.rules.push({
          include: browserNodeFiles.map((filename) =>
            path.resolve(__dirname, filename)
          ),
          loader: browserEmptyLoader,
        });
        config.externals = config.externals || [];
        config.externals.push({
          'better-sqlite3': 'commonjs better-sqlite3',
          '@vercel/postgres': 'commonjs @vercel/postgres',
          pg: 'commonjs pg',
          '@libsql/client': 'commonjs @libsql/client',
        });

        config.resolve.alias = {
          ...config.resolve.alias,
          'better-sqlite3': false,
          '@/lib/d1.db': false,
          '@/lib/d1-adapter': false,
          '@/lib/postgres.db': false,
          '@/lib/postgres-adapter': false,
          '@/lib/turso-adapter': false,
        };
      }

      return config;
    },
  };

  // Both bundlers generate PWA assets once, after a successful build, through
  // scripts/generate-pwa.cjs. Edge output continues to skip PWA generation.
  return nextConfig;
};

module.exports = createNextConfig;
