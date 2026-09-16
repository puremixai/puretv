import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import type { LookupFunction } from 'net';
import nodeFetch from 'node-fetch';
import { Readable, Transform } from 'stream';

import { PinnedProxyAgent } from './pinned-proxy-agent';
import { resolvePublicTarget } from './ssrf';

export interface OutboundPolicy {
  /** Exact origins from administrator-owned configuration only. */
  trustedOrigins?: readonly string[];
  /** Administrator-owned CONNECT proxy, resolved and pinned separately. */
  proxyUrl?: string;
  maxBytes?: number;
  timeoutMs?: number;
}

function pinnedLookup(
  addresses: { address: string; family: number }[],
): LookupFunction {
  return (_host, options, callback) => {
    const permitted = addresses.filter(
      (item) => !options.family || item.family === options.family,
    );
    if (!permitted.length)
      return callback(new Error('No permitted address for this family'), '', 0);
    if (options.all) callback(null, permitted);
    else callback(null, permitted[0].address, permitted[0].family);
  };
}

async function resolveWithTimeout(
  input: string,
  origins: readonly string[],
  timeoutMs: number,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      resolvePublicTarget(input, origins),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Media DNS timeout')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchPublicUrl(
  input: string,
  init: RequestInit = {},
  policy: OutboundPolicy = {},
): Promise<Response> {
  let url = input;
  const headers = new Headers(init.headers);
  for (const name of ['authorization', 'cookie', 'host', 'proxy-authorization'])
    headers.delete(name);
  const timeoutMs = policy.timeoutMs || 30_000;

  for (let hop = 0; hop <= 5; hop++) {
    if (init.signal?.aborted) throw new Error('Media request aborted');
    const target = await resolveWithTimeout(
      url,
      policy.trustedOrigins || [],
      timeoutMs,
    );
    const Agent = target.url.protocol === 'https:' ? HttpsAgent : HttpAgent;
    let agent: HttpAgent = new Agent({
      keepAlive: false,
      lookup: pinnedLookup(target.addresses),
    });
    if (policy.proxyUrl) {
      const proxy = new URL(policy.proxyUrl);
      // Proxy credentials belong to the configured proxy only, never the origin request.
      const endpoint = new URL(proxy);
      endpoint.username = '';
      endpoint.password = '';
      const proxyTarget = await resolveWithTimeout(
        endpoint.href,
        [endpoint.origin],
        timeoutMs,
      );
      agent.destroy();
      agent = new PinnedProxyAgent(
        proxy,
        {
          address: target.addresses[0].address,
          hostname: target.url.hostname.replace(/^\[|\]$/g, ''),
        },
        pinnedLookup(proxyTarget.addresses),
      );
    }
    const controller = new AbortController();
    let source: Readable | null = null;
    const abort = () => {
      controller.abort();
      source?.destroy(new Error('Media request aborted or timed out'));
    };
    if (init.signal?.aborted) controller.abort();
    init.signal?.addEventListener('abort', abort, { once: true });
    let timer = setTimeout(abort, timeoutMs);
    const refreshTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(abort, timeoutMs);
    };
    let streaming = false;
    const cleanup = () => {
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', abort);
      agent.destroy();
    };
    try {
      const response = await nodeFetch(target.url.href, {
        method: 'GET',
        headers: Object.fromEntries(headers.entries()),
        redirect: 'manual',
        agent,
        signal: controller.signal,
      });
      source = response.body as Readable | null;
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        source?.destroy();
        const location = response.headers.get('location');
        if (!location || hop === 5)
          throw new Error('Invalid or excessive media redirects');
        const next = new URL(location, target.url);
        if (next.origin !== target.url.origin) headers.delete('referer');
        url = next.href;
        continue;
      }
      const responseHeaders = new Headers();
      response.headers.forEach((value, name) =>
        responseHeaders.set(name, value),
      );
      if (responseHeaders.has('content-encoding')) {
        responseHeaders.delete('content-encoding');
        responseHeaders.delete('content-length');
      }
      responseHeaders.delete('set-cookie');
      if (
        policy.maxBytes &&
        Number(responseHeaders.get('content-length')) > policy.maxBytes
      ) {
        source?.destroy();
        throw new Error('Media response exceeds the size limit');
      }
      const noBody = [204, 205, 304].includes(response.status);
      let body: ReadableStream<Uint8Array> | null = null;
      if (!noBody && source) {
        let bytes = 0;
        const upstream = source;
        const limit = new Transform({
          transform(chunk, _encoding, callback) {
            refreshTimer();
            bytes += chunk.length;
            callback(
              policy.maxBytes && bytes > policy.maxBytes
                ? new Error('Media response exceeds the size limit')
                : null,
              chunk,
            );
          },
          destroy(error, callback) {
            upstream.destroy();
            cleanup();
            callback(error);
          },
        });
        upstream.once('error', (error) => limit.destroy(error));
        streaming = true;
        body = Readable.toWeb(
          upstream.pipe(limit),
        ) as ReadableStream<Uint8Array>;
      } else {
        source?.destroy();
      }
      const result = new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
      Object.defineProperty(result, 'url', { value: target.url.href });
      return result;
    } finally {
      if (!streaming) cleanup();
    }
  }
  throw new Error('Too many redirects');
}

export { readLimitedText } from './media-body';
