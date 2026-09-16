// Run after pnpm install. Creates a temporary SQLite database and starts a local development server.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomBytes, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { once } = require('node:events');
const { io } = require('socket.io-client');

async function within(promise, milliseconds = 20000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Socket operation timed out')),
          milliseconds
        );
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const work = path.join(root, '.data', `smoke-${randomUUID()}`);
  fs.mkdirSync(work, { recursive: true });
  const log = fs.openSync(path.join(work, 'server.log'), 'w');
  const password = randomBytes(24).toString('hex');
  const postgres = process.argv.includes('--postgres');
  if (postgres && !process.env.PG_SMOKE_URL) {
    throw new Error('--postgres requires PG_SMOKE_URL pointing to an empty disposable test database');
  }
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', log, log],
    env: {
      ...process.env,
      NODE_ENV: process.argv.includes('--production') ? 'production' : 'development',
      HOSTNAME: '127.0.0.1',
      PORT: String(port),
      USERNAME: 'smoke-owner',
      ADMIN_USERNAME: 'smoke-owner',
      PASSWORD: password,
      AUTH_SECRET: randomBytes(32).toString('hex'),
      NEXT_PUBLIC_STORAGE_TYPE: postgres ? 'postgres' : 'd1',
      ...(postgres ? { POSTGRES_URL: process.env.PG_SMOKE_URL } : {}),
      SQLITE_DB_PATH: path.join(work, 'puretv.db'),
      WATCH_ROOM_ENABLED: 'true',
      WATCH_ROOM_SERVER_TYPE: 'internal',
      ALLOW_SERVER_SCRIPTS: 'false',
      CRON_SECRET: '',
      CRON_PASSWORD: '',
      CF_PAGES: '',
      BUILD_TARGET: '',
      EDGEONE_PAGES: '',
    },
  });
  const sockets = [];
  const request = (route, options = {}) =>
    fetch(origin + route, { ...options, signal: AbortSignal.timeout(60_000) });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      if (child.exitCode !== null)
        throw new Error('Development server exited; inspect ' + work);
      try {
        if ((await request('/api/auth/socket')).status === 401) {
          ready = true;
          break;
        }
      } catch {
        /* Retry until the server has compiled. */
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    assert(ready, 'server readiness');
    for (const route of [
      '/api/image-proxy',
      '/api/proxy/logo',
      '/api/proxy/m3u8',
      '/api/proxy/key',
      '/api/proxy/segment',
      '/api/proxy-m3u8',
      '/api/proxy/vod/segment',
      '/api/video-proxy',
      '/api/cms-proxy',
    ]) {
      assert.equal((await request(route)).status, 401, 'anonymous ' + route);
    }
    const login = await request('/api/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
      },
      body: JSON.stringify({ username: 'smoke-owner', password }),
    });
    assert.equal(login.status, 200, 'login');
    const body = await login.json();
    assert(
      !body.token && !body.auth?.signature,
      'browser body hides credentials'
    );
    const cookies = login.headers.getSetCookie();
    const authCookie = cookies.find((value) => value.startsWith('auth='));
    assert(authCookie?.includes('HttpOnly'), 'HttpOnly cookie');
    const cookie = authCookie.split(';')[0];
    const profile = body.auth;
    const headers = { cookie, 'content-type': 'application/json' };
    assert.equal(
      (await request('/api/auth/socket', { headers })).status,
      200,
      'authenticated HTTP'
    );
    const mediaResponse = await request('/api/proxy-token', { headers });
    assert.equal(mediaResponse.status, 200);
    const media = (await mediaResponse.json()).token;
    assert.equal(
      (await request('/api/proxy-m3u8?token=' + media)).status,
      400,
      'media credential accepted before URL validation'
    );
    const forged = io(origin, {
      transports: ['websocket'],
      auth: { token: '{"username":"smoke-owner"}' },
      reconnection: false,
    });
    sockets.push(forged);
    const [error] = await within(once(forged, 'connect_error'));
    assert.equal(error.message, 'Unauthorized');
    const socket = io(origin, {
      transports: ['websocket'],
      extraHeaders: { cookie },
      reconnection: false,
    });
    sockets.push(socket);
    await within(once(socket, 'connect'));
    const registration = await new Promise((resolve, reject) =>
      socket
        .timeout(15_000)
        .emit(
          'tv-remote:register-tv',
          { deviceId: 'smoke-tv', deviceName: 'Smoke TV' },
          (err, result) => (err ? reject(err) : resolve(result))
        )
    );
    assert.equal(registration.success, true, 'TV registration');
    const room = await new Promise((resolve, reject) =>
      socket
        .timeout(15_000)
        .emit(
          'room:create',
          { name: 'Smoke room', userName: 'forged-name', isPublic: true },
          (err, result) => (err ? reject(err) : resolve(result))
        )
    );
    assert.equal(room.room.ownerName, 'smoke-owner', 'verified room identity');
    assert.equal(
      (
        await request('/api/auth/devices', {
          method: 'DELETE',
          headers,
          body: JSON.stringify({ tokenId: profile.tokenId }),
        })
      ).status,
      200,
      'revoke device'
    );
    assert.equal(
      (await request('/api/auth/socket', { headers })).status,
      401,
      'revoked HTTP'
    );
    assert.equal(
      (await request('/api/proxy-m3u8?token=' + media)).status,
      401,
      'revoked media token'
    );
    const disconnected = once(socket, 'disconnect');
    socket.emit('tv-remote:tv-state', { deviceId: 'smoke-tv' });
    await within(disconnected);
    assert.equal(
      (await request('/api/auth/refresh', { method: 'POST', headers })).status,
      401,
      'revoked refresh'
    );
    console.log(
      'PASS: HTTP login, HttpOnly cookie, anonymous proxy rejection, signed media token, forged socket rejection, TV registration, room identity, device revocation, socket disconnect and refresh rejection.'
    );
  } finally {
    for (const socket of sockets) socket.disconnect();
    if (child.exitCode === null) {
      child.kill();
      await once(child, 'exit');
    }
    fs.closeSync(log);
    console.log('Temporary verification database and server log: ' + work);
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
