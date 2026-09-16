import { validateProxyUrlServerSide } from './edge-ssrf';
import type { OutboundPolicy } from './public-fetch';

/** Edge fetch cannot use Node's pinned DNS agent. Restrict proxying to explicitly trusted hosts. */
export async function fetchPublicUrl(
  input: string,
  init: RequestInit = {},
  policy: OutboundPolicy = {},
): Promise<Response> {
  // Workers cannot reproduce DNS-pinned CONNECT. Never silently bypass a proxy
  // chosen by the administrator, or turn Node LAN grants into Edge permissions.
  if (policy.proxyUrl) throw new Error('CONNECT proxy is unsupported on Edge');
  const headers = new Headers(init.headers);
  for (const name of ['authorization', 'cookie', 'host', 'proxy-authorization'])
    headers.delete(name);
  let url = new URL(input);
  for (let hop = 0; hop <= 5; hop++) {
    if (init.signal?.aborted) throw new Error('Media request aborted');
    if (!(await validateProxyUrlServerSide(url.href))) {
      throw new Error(
        'Edge media proxy requires this host in MEDIA_PROXY_ALLOWED_HOSTS'
      );
    }
    const abortController = new AbortController();
    const timeoutMs = policy.timeoutMs || 30_000;
    let timer: ReturnType<typeof setTimeout>;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let downstream: ReadableStreamDefaultController<Uint8Array> | undefined;
    let finished = false;
    let streaming = false;
    const cleanup = () => {
      finished = true;
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', onAbort);
    };
    const stop = (error: unknown) => {
      if (finished) return;
      cleanup();
      abortController.abort();
      downstream?.error(error);
      void reader?.cancel(error).catch(() => undefined);
    };
    const onAbort = () => stop(new Error('Media request aborted'));
    const refreshTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => stop(new Error('Media request timed out')),
        timeoutMs,
      );
    };
    init.signal?.addEventListener('abort', onAbort, { once: true });
    if (init.signal?.aborted) onAbort();
    refreshTimer();
    try {
      const response = await fetch(url, {
        ...init,
        headers: new Headers(headers),
        redirect: 'manual',
        signal: abortController.signal,
      });
      if (abortController.signal.aborted) {
        await response.body?.cancel();
        throw new Error('Media request aborted or timed out');
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!location || hop === 5)
          throw new Error('Invalid or excessive media redirects');
        const next = new URL(location, url);
        if (next.origin !== url.origin) headers.delete('referer');
        url = next;
        continue;
      }
      const responseHeaders = new Headers(response.headers);
      responseHeaders.delete('set-cookie');
      // Native fetch exposes decoded bytes. Do not advertise their encoded size.
      if (responseHeaders.has('content-encoding')) {
        responseHeaders.delete('content-encoding');
        responseHeaders.delete('content-length');
      }
      if (
        policy.maxBytes &&
        Number(responseHeaders.get('content-length')) > policy.maxBytes
      ) {
        await response.body?.cancel();
        throw new Error('Media response exceeds the size limit');
      }
      let body: ReadableStream<Uint8Array> | null = null;
      if (response.body && ![204, 205, 304].includes(response.status)) {
        const upstream = response.body.getReader();
        reader = upstream;
        let bytes = 0;
        streaming = true;
        body = new ReadableStream<Uint8Array>({
          start(controller) {
            downstream = controller;
            refreshTimer();
          },
          async pull(controller) {
            try {
              const { done, value } = await upstream.read();
              if (finished) return;
              if (done) {
                cleanup();
                upstream.releaseLock();
                controller.close();
                return;
              }
              bytes += value.byteLength;
              if (policy.maxBytes && bytes > policy.maxBytes)
                throw new Error('Media response exceeds the size limit');
              refreshTimer();
              controller.enqueue(value);
            } catch (error) {
              stop(error);
            }
          },
          async cancel(reason) {
            cleanup();
            abortController.abort();
            await upstream.cancel(reason);
            upstream.releaseLock();
          },
        });
      } else {
        await response.body?.cancel();
      }
      const result = new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
      Object.defineProperty(result, 'url', { value: url.href });
      return result;
    } finally {
      if (!streaming) cleanup();
    }
  }
  throw new Error('Too many redirects');
}

export { readLimitedText } from './media-body';
