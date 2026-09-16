import { isGoWorkerEnabled, requestWorker } from './go-worker';
import { readLimitedText } from './media-body';
import { fetchSearchResponse } from './search-control';

/** Only called with a CMS URL obtained from the authorized server source configuration. */
export async function fetchCmsResponse(
  url: string,
  init: RequestInit = {},
  timeoutMs = 8000,
  operation: 'search' | 'videos' | 'categories' | 'downstream' = 'downstream',
): Promise<Response> {
  if (!isGoWorkerEnabled('search')) {
    const response = await fetchSearchResponse(url, init, timeoutMs);
    response.headers.delete('x-puretv-cms-native');
    return response;
  }
  const headers: Record<string, string> = {};
  const endpoint = new URL(url);
  const query = endpoint.searchParams.get('wd') || '';
  const page = endpoint.searchParams.get('pg') || '1';
  const categoryId = endpoint.searchParams.get('t') || '';
  for (const name of ['ac', 'wd', 'pg', 't'])
    endpoint.searchParams.delete(name);
  const incoming = new Headers(init.headers);
  for (const name of ['user-agent', 'accept']) {
    const value = incoming.get(name);
    if (value) headers[name] = value;
  }
  // Failure is handled by the existing caller; never retry a selected Go request in Node.
  const response = await requestWorker(
    '/v1/cms',
    {
      method: 'POST',
      signal: init.signal,
      body: JSON.stringify({
        url: endpoint.toString(),
        operation,
        query,
        page,
        categoryId,
        headers,
        timeoutMs,
      }),
    },
    timeoutMs,
  );
  const body = await readLimitedText(response, 8 * 1024 * 1024);
  if (response.ok) {
    const document = JSON.parse(body);
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new Error('Invalid Go CMS response');
    }
    if (operation !== 'categories' && document.list != null) {
      if (
        !Array.isArray(document.list) ||
        !document.list.every(
          (item: Record<string, unknown>) =>
            item &&
            Array.isArray(item.puretv_episodes) &&
            item.puretv_episodes.every(
              (url: unknown) => typeof url === 'string',
            ) &&
            Array.isArray(item.puretv_episode_titles) &&
            item.puretv_episode_titles.every(
              (title: unknown) => typeof title === 'string',
            ) &&
            item.puretv_episodes.length === item.puretv_episode_titles.length,
        )
      ) {
        throw new Error('Invalid Go CMS playback fields');
      }
    }
  }
  return new Response([204, 205, 304].includes(response.status) ? null : body, {
    status: response.status,
    headers: { 'Content-Type': 'application/json', 'x-puretv-cms-native': '1' },
  });
}
