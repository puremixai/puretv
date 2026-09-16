const { randomBytes, timingSafeEqual } = require('node:crypto');
const key = Symbol.for('puretv.ai-comment-worker');
function state() {
  return (
    globalThis[key] ||
    (globalThis[key] = {
      secret: randomBytes(32).toString('hex'),
      timer: null,
      active: 0,
    })
  );
}

function isAICommentWorkerToken(token) {
  const expected = state().secret;
  return (
    typeof token === 'string' &&
    Buffer.byteLength(token) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  );
}

function startAICommentWorker(origin) {
  if (
    process.env.NEXT_PUBLIC_STORAGE_TYPE !== 'postgres' ||
    process.env.AI_COMMENT_WORKER_ENABLED === 'false'
  )
    return;
  const worker = state();
  if (worker.timer) return;
  const tick = () => {
    while (worker.active < 2) {
      worker.active++;
      fetch(origin + '/api/ai-comments/worker', {
        method: 'POST',
        headers: { 'x-ai-worker-token': worker.secret },
        signal: AbortSignal.timeout(90000),
      })
        .then(async (response) => {
          await response.arrayBuffer();
          if (!response.ok)
            console.error('AI comment worker HTTP error:', response.status);
        })
        .catch(() => console.error('AI comment worker temporarily unavailable'))
        .finally(() => {
          worker.active--;
        });
    }
  };
  worker.timer = setInterval(tick, 2000);
  worker.timer.unref();
  tick();
}

module.exports = { startAICommentWorker, isAICommentWorkerToken };
