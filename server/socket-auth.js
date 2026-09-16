function socketCredentialHeaders(socket) {
  const headers = {};
  const cookie = socket.handshake.headers.cookie;
  if (typeof cookie === 'string' && cookie) headers.cookie = cookie;
  const token = socket.handshake.auth?.token;
  if (typeof token === 'string' && token)
    headers.authorization = `Bearer ${token}`;
  return headers;
}

// The target comes from the server's bind address, never a request Host/Origin header.
function installSocketAuthentication(io, { origin, fetchImpl = fetch }) {
  async function authenticate(socket) {
    const headers = socketCredentialHeaders(socket);
    if (!headers.cookie && !headers.authorization)
      throw new Error('Unauthorized');
    const response = await fetchImpl(`${origin}/api/auth/socket`, {
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Unauthorized');
    const user = await response.json();
    if (typeof user.username !== 'string' || !user.username)
      throw new Error('Unauthorized');
    if (socket.data.username && socket.data.username !== user.username)
      throw new Error('Unauthorized');
    socket.data.username = user.username;
  }

  io.use(async (socket, next) => {
    try {
      await authenticate(socket);
      // Check persisted revocation/bans on every incoming event, including long-lived connections.
      socket.use(async (_packet, proceed) => {
        try {
          await authenticate(socket);
          proceed();
        } catch {
          socket.emit('auth:expired');
          socket.disconnect(true);
          proceed(new Error('Unauthorized'));
        }
      });
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });
}

module.exports = { installSocketAuthentication };
