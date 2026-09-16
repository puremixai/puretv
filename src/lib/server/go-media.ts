import { isGoWorkerEnabled, requestWorker } from './go-worker';
import { readLimitedText } from './media-body';

export { isGoWorkerEnabled };

export async function requestGoMedia(
  path: string,
  input: object,
  signal?: AbortSignal,
  timeoutMs = 35_000,
): Promise<Response> {
  return requestWorker(
    path,
    {
      method: 'POST',
      body: JSON.stringify(input),
      signal,
    },
    timeoutMs,
  );
}

export async function parseGoEpg(url: string, ua: string, tvgIds: string[]) {
  const response = await requestGoMedia('/v1/live/epg', { url, ua, tvgIds });
  if (!response.ok) {
    void response.body?.cancel();
    throw new Error('Go EPG request failed');
  }
  return JSON.parse(
    await readLimitedText(response, 64 * 1024 * 1024),
  ) as Record<string, { start: string; end: string; title: string }[]>;
}

/** HTTP transport only; callers retain API key rotation, caches and mirror policy. */
export async function fetchGoMetadata(
  url: string,
  headers?: Record<string, string>,
  proxy?: string,
): Promise<Response> {
  const response = await requestGoMedia('/v1/metadata/fetch', {
    url,
    headers,
    proxy,
  });
  if (!response.ok) {
    void response.body?.cancel();
    throw new Error('Go metadata request failed');
  }
  const result = JSON.parse(await readLimitedText(response, 64 * 1024 * 1024));
  if (
    !Number.isInteger(result.status) ||
    result.status < 200 ||
    result.status > 599 ||
    typeof result.body !== 'string'
  ) {
    throw new Error('Invalid Go metadata response');
  }
  return new Response(
    [204, 205, 304].includes(result.status) ? null : result.body,
    {
      status: result.status,
      statusText: result.statusText,
      headers: { 'Content-Type': result.contentType || 'application/json' },
    },
  );
}
