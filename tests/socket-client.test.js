/** @jest-environment node */
const { EventEmitter } = require('events');
const { attachSocketSession } = require('../src/lib/socket-session.client');
const flush = () => new Promise((resolve) => setImmediate(resolve));
function socket() {
  const client = new EventEmitter();
  client.connect = jest.fn();
  return client;
}
afterEach(() => {
  delete global.fetch;
});

test('refreshes an expired handshake once and reconnects after success', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
  const client = socket(),
    dispose = attachSocketSession(client);
  client.emit('connect_error', new Error('Unauthorized'));
  client.emit('connect_error', new Error('Unauthorized'));
  await flush();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(client.connect).toHaveBeenCalledTimes(1);
  dispose();
});

test('revocation and disposed connections never reconnect', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false });
  const client = socket(),
    dispose = attachSocketSession(client);
  client.emit('auth:expired');
  await flush();
  expect(client.connect).not.toHaveBeenCalled();
  global.fetch.mockResolvedValue({ ok: true });
  client.emit('auth:expired');
  dispose();
  await flush();
  expect(client.connect).not.toHaveBeenCalled();
});
