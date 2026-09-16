/** @jest-environment node */
const { webcrypto } = require('crypto');
const {
  signAuthData,
  verifyAuthSignature,
} = require('../src/lib/auth-signature');
const { TOKEN_CONFIG } = require('../src/lib/token-config');
const { parseAuthInfo } = require('../src/lib/auth');
const { installSocketAuthentication } = require('../server/socket-auth');
const hub = require('../src/lib/tv-remote-hub');

beforeAll(() => {
  global.crypto = webcrypto;
});
beforeEach(() => {
  process.env.PASSWORD = 'test-only-secret';
  process.env.USERNAME = 'owner';
  process.env.NEXT_PUBLIC_STORAGE_TYPE = 'd1';
});
afterEach(() => hub.clearTVRemoteHub());

test('room ownership requires the verified account and public listings expose no credentials', () => {
  const { canResumeRoom, roomForList } = require('../server/room-access');
  const room = {
    id: 'room',
    ownerName: 'alice',
    ownerToken: 'secret',
    password: 'private',
  };
  expect(canResumeRoom(room, 'bob', 'secret')).toBe(false);
  expect(canResumeRoom(room, 'alice', 'secret')).toBe(true);
  expect(roomForList(room)).not.toHaveProperty('ownerToken');
  expect(roomForList(room).password).not.toBe('private');
});

async function token(overrides = {}) {
  const data = {
    version: 2,
    username: 'alice',
    role: 'user',
    timestamp: Date.now(),
    tokenId: 'a'.repeat(32),
    refreshToken: 'b'.repeat(64),
    refreshExpires: Date.now() + TOKEN_CONFIG.REFRESH_TOKEN_AGE,
    ...overrides,
  };
  return { ...data, signature: await signAuthData(data) };
}

test('accepts a valid session and rejects forged or modified identity/session fields', async () => {
  const auth = await token();
  expect(await verifyAuthSignature(auth)).toBe(true);
  for (const patch of [
    { username: 'owner' },
    { role: 'owner' },
    { tokenId: 'c'.repeat(32) },
    { refreshToken: 'd'.repeat(64) },
    { refreshExpires: auth.refreshExpires + 1000 },
    { timestamp: auth.timestamp + 1 },
    { version: undefined },
  ])
    expect(await verifyAuthSignature({ ...auth, ...patch })).toBe(false);
  expect(await verifyAuthSignature({ username: 'owner' })).toBe(false);
});

test('rejects expired and future-dated tokens but allows a valid refresh flow', async () => {
  const expiredAccess = await token({
    timestamp: Date.now() - TOKEN_CONFIG.ACCESS_TOKEN_AGE - 1000,
  });
  expect(await verifyAuthSignature(expiredAccess)).toBe(false);
  expect(
    await verifyAuthSignature(expiredAccess, { allowExpiredAccessToken: true })
  ).toBe(true);
  expect(
    await verifyAuthSignature(await token({ refreshExpires: Date.now() - 1 }), {
      allowExpiredAccessToken: true,
    })
  ).toBe(false);
  expect(
    await verifyAuthSignature(await token({ timestamp: Date.now() + 60_000 }))
  ).toBe(false);
});

test('local sessions require a signed owner identity and never rely on a cookie password', async () => {
  process.env.NEXT_PUBLIC_STORAGE_TYPE = 'localstorage';
  expect(
    await verifyAuthSignature(await token({ username: 'owner', role: 'owner' }))
  ).toBe(true);
  expect(
    await verifyAuthSignature({
      username: 'owner',
      password: process.env.PASSWORD,
    })
  ).toBe(false);
  expect(
    await verifyAuthSignature(await token({ username: 'alice', role: 'owner' }))
  ).toBe(false);
});

test.each(['null', '[]', '"text"', '1', '{'])(
  'rejects non-object authentication payload %s',
  (input) => {
    expect(parseAuthInfo(input)).toBeNull();
  }
);

test('device IDs cannot be taken over by another user and same-user reconnection is safe', () => {
  expect(
    hub.registerTVRemoteDevice('one', 'alice', { deviceId: 'tv' }).success
  ).toBe(true);
  expect(
    hub.registerTVRemoteDevice('two', 'bob', { deviceId: 'tv' }).success
  ).toBe(false);
  expect(
    hub.registerTVRemoteDevice('three', 'alice', { deviceId: 'tv' }).success
  ).toBe(true);
  hub.removeTVRemoteSocket('one');
  expect(hub.listTVRemoteDevices('alice')).toHaveLength(1);
  expect(hub.listTVRemoteDevices('bob')).toHaveLength(0);
});

function setupSocket(
  fetchImpl,
  credentials = { token: '{"username":"owner"}' }
) {
  let middleware;
  let packet;
  const socket = {
    data: {},
    handshake: { headers: {}, auth: credentials },
    use: (callback) => {
      packet = callback;
    },
    emit: jest.fn(),
    disconnect: jest.fn(),
  };
  installSocketAuthentication(
    {
      use: (fn) => {
        middleware = fn;
      },
    },
    { origin: 'http://127.0.0.1:3000', fetchImpl }
  );
  return {
    socket,
    connect: (next) => middleware(socket, next),
    packet: (...args) => packet(...args),
  };
}

test('Socket rejects forged credentials and does not trust the embedded username', async () => {
  const fakeFetch = jest.fn().mockResolvedValue({ ok: false });
  const connection = setupSocket(fakeFetch);
  const next = jest.fn();
  await connection.connect(next);
  expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
  expect(connection.socket.data.username).toBeUndefined();
});

test('Socket binds the verified identity and disconnects a revoked session before handling an event', async () => {
  const fakeFetch = jest
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ username: 'alice' }),
    })
    .mockResolvedValueOnce({ ok: false });
  const connection = setupSocket(fakeFetch);
  const next = jest.fn();
  await connection.connect(next);
  expect(next).toHaveBeenCalledWith();
  expect(connection.socket.data.username).toBe('alice');
  const proceed = jest.fn();
  await connection.packet(['tv-remote:register-tv', {}], proceed);
  expect(proceed.mock.calls[0][0]).toBeInstanceOf(Error);
  expect(connection.socket.disconnect).toHaveBeenCalledWith(true);
});

test('Socket rejects anonymous access without requesting the authentication endpoint', async () => {
  const fakeFetch = jest.fn();
  const connection = setupSocket(fakeFetch, {});
  const next = jest.fn();
  await connection.connect(next);
  expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
  expect(fakeFetch).not.toHaveBeenCalled();
});
