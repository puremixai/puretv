// Provision disposable, loopback-only services for integration tests.
const { execFileSync, spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const suffix = randomBytes(5).toString('hex');
const postgres = `puretv-pg-test-${suffix}`;
const redis = `puretv-redis-test-${suffix}`;
const password = randomBytes(24).toString('hex');
const docker = (args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
(async () => {
  try {
    docker([
      'run',
      '-d',
      '--name',
      postgres,
      '-p',
      '127.0.0.1::5432',
      '-e',
      'POSTGRES_USER=test',
      '-e',
      'POSTGRES_DB=puretvtest',
      '-e',
      `POSTGRES_PASSWORD=${password}`,
      'postgres:17-alpine',
    ]);
    docker([
      'run',
      '-d',
      '--name',
      redis,
      '-p',
      '127.0.0.1::6379',
      'redis:7-alpine',
      'redis-server',
      '--save',
      '',
      '--appendonly',
      'no',
      '--requirepass',
      password,
    ]);
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        docker(['exec', postgres, 'pg_isready', '-U', 'test', '-d', 'puretvtest']);
        ready = true;
        break;
      } catch {
        await sleep(500);
      }
    }
    if (!ready) throw new Error('PostgreSQL did not start');
    const pgAddress = docker(['port', postgres, '5432/tcp']);
    const redisAddress = docker(['port', redis, '6379/tcp']);
    const result = spawnSync(
      process.execPath,
      [
        require.resolve('jest/bin/jest'),
        '--runInBand',
        ...process.argv.slice(2),
      ],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          POSTGRES_URL: `postgresql://test:${password}@${pgAddress}/puretvtest`,
          PG_TEST_URL: `postgresql://test:${password}@${pgAddress}/puretvtest`,
          CACHE_REDIS_URL: `redis://:${password}@${redisAddress}/0`,
          TEST_REDIS_CONTAINER: redis,
        TEST_POSTGRES_CONTAINER: postgres,
        },
      }
    );
    process.exitCode = result.status ?? 1;
  } finally {
    for (const name of [redis, postgres])
      try {
        docker(['rm', '-f', '-v', name]);
      } catch {
        /* Own temporary resources only. */
      }
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
