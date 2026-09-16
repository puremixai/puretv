type SessionSocket = {
  on(event: 'auth:expired', callback: () => void): unknown;
  on(event: 'connect_error', callback: (error: Error) => void): unknown;
  on(event: 'connect', callback: () => void): unknown;
  off(event: 'auth:expired', callback: () => void): unknown;
  off(event: 'connect_error', callback: (error: Error) => void): unknown;
  off(event: 'connect', callback: () => void): unknown;
  connect(): unknown;
};

let pendingRefresh: Promise<boolean> | null = null;

/** Renew through HttpOnly cookies before reconnecting an internal socket. */
export function attachSocketSession(socket: SessionSocket) {
  let disposed = false;
  let attempted = false;
  const refresh = async () => {
    pendingRefresh ||= fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => {
        pendingRefresh = null;
      });
    if ((await pendingRefresh) && !disposed) socket.connect();
  };
  socket.on('auth:expired', refresh);
  const onError = (error: Error) => {
    if (error.message === 'Unauthorized' && !attempted) {
      attempted = true;
      void refresh();
    }
  };
  const onConnect = () => {
    attempted = false;
  };
  socket.on('connect_error', onError);
  socket.on('connect', onConnect);
  return () => {
    disposed = true;
    socket.off('auth:expired', refresh);
    socket.off('connect_error', onError);
    socket.off('connect', onConnect);
  };
}
