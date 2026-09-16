const http = require('node:http');

function probeHealth({
  port = process.env.PORT || 3000,
  timeoutMs = 5000,
} = {}) {
  const numericPort = Number(port);
  if (
    !Number.isInteger(numericPort) ||
    numericPort < 1 ||
    numericPort > 65535
  ) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    let request;
    const finish = (healthy) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Readiness is represented by the HTTP status. Close the connection once
      // it is known so a stalled or streaming body cannot keep the CLI alive.
      request?.destroy();
      resolve(healthy);
    };
    request = http.get(
      {
        hostname: '127.0.0.1',
        port: numericPort,
        path: '/api/health',
        agent: false,
        headers: { Connection: 'close' },
      },
      (response) => {
        response.resume();
        finish(response.statusCode >= 200 && response.statusCode < 300);
      },
    );
    request.on('error', () => finish(false));
    timer = setTimeout(() => {
      request.destroy();
      finish(false);
    }, timeoutMs);
  });
}

module.exports = { probeHealth };
if (require.main === module) {
  probeHealth().then((healthy) => {
    process.exitCode = healthy ? 0 : 1;
  });
}
