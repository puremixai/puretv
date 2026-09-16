// Shared across route bundles in one Node process. No request/user state is cached here.
export function abortError() {
  return new DOMException('搜索已取消', 'AbortError');
}

export function checkSearchSignal(signal?: AbortSignal | null) {
  if (signal?.aborted) throw signal.reason || abortError();
}

export function searchScope(parent?: AbortSignal | null, timeoutMs = 60000) {
  const controller = new AbortController();
  const cancel = () => controller.abort(parent?.reason || abortError());
  if (parent?.aborted) cancel();
  else parent?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(
    () => controller.abort(new DOMException('搜索超时', 'TimeoutError')),
    timeoutMs
  );
  return {
    signal: controller.signal,
    abort: () => controller.abort(abortError()),
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener('abort', cancel);
    },
  };
}

export class SearchSemaphore {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private limit: number, private maxQueued = 512) {}

  async run<T>(
    task: () => Promise<T>,
    signal?: AbortSignal | null
  ): Promise<T> {
    checkSearchSignal(signal);
    await new Promise<void>((resolve, reject) => {
      const enter = () => {
        signal?.removeEventListener('abort', cancel);
        this.active++;
        resolve();
      };
      const cancel = () => {
        const index = this.queue.indexOf(enter);
        if (index >= 0) this.queue.splice(index, 1);
        reject(signal?.reason || abortError());
      };
      if (this.active < this.limit) enter();
      else if (this.queue.length >= this.maxQueued)
        reject(new Error('搜索繁忙，请稍后重试'));
      else {
        this.queue.push(enter);
        signal?.addEventListener('abort', cancel, { once: true });
      }
    });
    try {
      checkSearchSignal(signal);
      return await task();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

const poolsKey = Symbol.for('puretv.search.pools');
const registry = globalThis as typeof globalThis & {
  [poolsKey]?: { sources: SearchSemaphore; network: SearchSemaphore };
};
const pools =
  registry[poolsKey] ||
  (registry[poolsKey] = {
    sources: new SearchSemaphore(8, 256),
    network: new SearchSemaphore(16, 512),
  });
export const searchSourcePool = pools.sources;

// Read the entire body under the same deadline and connection permit as headers.
// Returning a buffered Response keeps existing callers' status/json/text handling intact.
export function fetchSearchResponse(
  url: string | URL,
  init: RequestInit = {},
  timeoutMs = 8000
): Promise<Response> {
  return pools.network.run(async () => {
    const scope = searchScope(init.signal, timeoutMs);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      checkSearchSignal(scope.signal);
      const response = await fetch(url, { ...init, signal: scope.signal });
      const limit = 8 * 1024 * 1024;
      if (Number(response.headers.get('content-length')) > limit) {
        await response.body?.cancel();
        throw new Error('搜索响应过大');
      }
      reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (reader) {
        checkSearchSignal(scope.signal);
        const part = await reader.read();
        if (part.done) break;
        length += part.value.byteLength;
        if (length > limit) throw new Error('搜索响应过大');
        chunks.push(part.value);
      }
      checkSearchSignal(scope.signal);
      const body = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const headers = new Headers(response.headers);
      headers.delete('content-encoding');
      headers.delete('content-length');
      const buffered = new Response(
        [204, 205, 304].includes(response.status) ? null : body,
        {
          status: response.status,
          statusText: response.statusText,
          headers,
        }
      );
      Object.defineProperty(buffered, 'url', { value: response.url });
      return buffered;
    } finally {
      scope.abort();
      await reader?.cancel().catch(() => undefined);
      scope.dispose();
    }
  }, init.signal);
}

export async function mapSearchTasks<T, R>(
  items: T[],
  signal: AbortSignal,
  task: (item: T) => Promise<R>,
  concurrency = 4
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        checkSearchSignal(signal);
        const index = next++;
        results[index] = await task(items[index]);
      }
    })
  );
  return results;
}
