import type { OpenNextConfig } from '@opennextjs/cloudflare';

const config: OpenNextConfig = {
  default: {
    override: {
      wrapper: 'cloudflare-node',
      converter: 'edge',
      proxyExternalRequest: 'fetch',
      incrementalCache: 'dummy',
      tagCache: 'dummy',
      queue: 'dummy',
    },
  },
  edgeExternals: [
    'node:crypto',
    'node:async_hooks',
    'node:buffer',
    'node:stream',
    'node:util',
    'node:events',
    'node:path',
    'node:url',
    'node:fs',
    'node:http',
    'node:https',
    'node:net',
    'node:tls',
    'node:dns',
    'node:os',
    'node:zlib',
    'node:vm',
    'node:child_process',
    'node:string_decoder',
    'node:tty',
    'node:assert',
    'node:punycode',
    'node:timers',
    'node:worker_threads',
  ],
  middleware: {
    external: true,
    override: {
      wrapper: 'cloudflare-edge',
      converter: 'edge',
      proxyExternalRequest: 'fetch',
      incrementalCache: 'dummy',
      tagCache: 'dummy',
      queue: 'dummy',
    },
  },
};

export default config;
