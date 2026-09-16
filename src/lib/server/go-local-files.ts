import type { NextRequest } from 'next/server';

import { requestWorker } from './go-worker';

export interface LocalFileParams {
  source: string;
  videoId: string;
  episodeIndex: string;
  file: string;
}

/** The public route must perform its existing feature and admin checks first. */
export async function forwardLocalFile(
  request: NextRequest,
  params: LocalFileParams,
  format: 'query' | 'path',
): Promise<Response> {
  const connectionTimeout = new AbortController();
  const timer = setTimeout(() => connectionTimeout.abort(), 30_000);
  try {
    const query = new URLSearchParams({ ...params, format });
    const headers = new Headers();
    for (const name of [
      'range',
      'if-range',
      'if-modified-since',
      'if-none-match',
    ]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const response = await requestWorker(
      `/v1/local-files?${query}`,
      {
        method: request.method,
        headers,
        signal: AbortSignal.any([request.signal, connectionTimeout.signal]),
      },
      // This timeout covers the streaming body as well as response headers.
      24 * 60 * 60 * 1000,
    );
    clearTimeout(timer);
    const resultHeaders = new Headers({ 'Cache-Control': 'private, no-cache' });
    for (const name of [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'last-modified',
      'etag',
      'x-content-type-options',
    ]) {
      const value = response.headers.get(name);
      if (value) resultHeaders.set(name, value);
    }
    return new Response(request.method === 'HEAD' ? null : response.body, {
      status: response.status,
      headers: resultHeaders,
    });
  } catch {
    return Response.json(
      { error: 'Go 本地文件服务暂时不可用' },
      { status: 503 },
    );
  } finally {
    clearTimeout(timer);
  }
}
