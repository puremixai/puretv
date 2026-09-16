import type { QuarkRangeWindow } from './quark.client';

const DEFAULT_CHUNK_SIZE = 1024 * 1024;
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_CHUNK_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 300;

function buildRangeHeader(start: number, end: number) {
  return `bytes=${start}-${end}`;
}

function splitRange(start: number, end: number, chunkSize = DEFAULT_CHUNK_SIZE) {
  const chunks: Array<{ index: number; start: number; end: number }> = [];
  let index = 0;
  for (let cursor = start; cursor <= end; cursor += chunkSize) {
    chunks.push({
      index,
      start: cursor,
      end: Math.min(cursor + chunkSize - 1, end),
    });
    index += 1;
  }
  return chunks;
}

function isAbortError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.message.includes('aborted'))
  );
}

function waitForRetry(ms: number, signal: AbortSignal) {
  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  return new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(new DOMException('Aborted', 'AbortError'));
    };

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function fetchChunkOnce(
  url: string,
  headers: Record<string, string>,
  chunk: { start: number; end: number },
  signal: AbortSignal
) {
  const response = await fetch(url, {
    headers: {
      ...headers,
      Range: buildRangeHeader(chunk.start, chunk.end),
    },
    cache: 'no-store',
    signal,
  });

  if (!response.ok) {
    try {
      await response.body?.cancel();
    } catch {
      void 0;
    }
    throw new Error(`chunk request failed (${response.status})`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

async function fetchChunk(
  url: string,
  headers: Record<string, string>,
  chunk: { start: number; end: number },
  signal: AbortSignal,
  retries = DEFAULT_CHUNK_RETRIES
) {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchChunkOnce(url, headers, chunk, signal);
    } catch (error) {
      if (isAbortError(error) || attempt >= retries) {
        throw error;
      }

      lastError = error;
      await waitForRetry(RETRY_BASE_DELAY_MS * 2 ** attempt, signal);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('chunk request failed');
}

export function createQuarkMultiThreadStream(input: {
  url: string;
  headers: Record<string, string>;
  window: QuarkRangeWindow;
  contentHeaders: Headers;
  status: number;
}) {
  const { url, headers, window, contentHeaders, status } = input;
  const chunks = splitRange(window.start, window.end);
  const abortController = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const results = new Map<number, Uint8Array>();
      let nextFetch = 0;
      let active = 0;
      let failed = false;

      const done = new Promise<void>((resolve, reject) => {
        const launch = () => {
          if (failed) return;
          if (results.size >= chunks.length) {
            resolve();
            return;
          }

          while (active < DEFAULT_CONCURRENCY && nextFetch < chunks.length) {
            const chunk = chunks[nextFetch];
            nextFetch += 1;
            active += 1;

            fetchChunk(url, headers, chunk, abortController.signal)
              .then((data) => {
                results.set(chunk.index, data);
                if (results.size >= chunks.length) {
                  resolve();
                }
              })
              .catch((error) => {
                if (isAbortError(error)) {
                  return;
                }
                failed = true;
                reject(error);
              })
              .finally(() => {
                active -= 1;
                launch();
              });
          }
        };

        launch();
      });

      await done;
      for (let index = 0; index < chunks.length; index += 1) {
        const data = results.get(index);
        if (!data) {
          throw new Error(`chunk missing (${index})`);
        }
        controller.enqueue(data);
      }
      controller.close();
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    status,
    headers: contentHeaders,
  });
}
