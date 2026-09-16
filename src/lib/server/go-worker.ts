import type { NextRequest } from 'next/server';

import type { OpenListFile } from '@/lib/openlist.client';

import { readLimitedText } from './media-body';

const workerFeatures = {
  offlineDownloads: 'PURETV_GO_OFFLINE_DOWNLOADS',
  localFiles: 'PURETV_GO_LOCAL_FILES',
  openlistScan: 'PURETV_GO_OPENLIST_SCAN',
  live: 'PURETV_GO_LIVE',
  netdiskCheck: 'PURETV_GO_NETDISK_CHECK',
  search: 'PURETV_GO_SEARCH',
  subscriptions: 'PURETV_GO_SUBSCRIPTIONS',
  danmaku: 'PURETV_GO_DANMAKU',
  metadata: 'PURETV_GO_METADATA',
  tasks: 'PURETV_GO_TASKS',
  animeDownloads: 'PURETV_GO_ANIME_DOWNLOADS',
} as const;

type WorkerFeature = keyof typeof workerFeatures;

export function isGoWorkerEnabled(feature: WorkerFeature): boolean {
  return process.env[workerFeatures[feature]] === 'true';
}

function workerConnection() {
  const token = process.env.PURETV_GO_TOKEN || '';
  const value = process.env.PURETV_GO_URL || '';
  if (!value || token.length < 32 || /\s/.test(token)) {
    throw new Error('Go worker 配置不完整');
  }
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error('Go worker 地址必须为 HTTP(S) origin');
  }
  return { origin: url.origin, token };
}

class WorkerBodyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function readWorkerBody(
  request: NextRequest,
): Promise<ArrayBuffer | undefined> {
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  let failure: WorkerBodyError | undefined;
  const stop = () => {
    failure = new WorkerBodyError('请求读取超时或已取消', 408);
    void reader.cancel().catch(() => undefined);
  };
  const timer = setTimeout(stop, 15_000);
  request.signal.addEventListener('abort', stop, { once: true });
  if (request.signal.aborted) stop();
  try {
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (failure) throw failure;
      if (done) break;
      length += value.byteLength;
      if (length > 1024 * 1024) throw new WorkerBodyError('请求内容过大', 413);
      chunks.push(value);
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return body.buffer;
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', stop);
    reader.releaseLock();
  }
}

export async function requestWorker(
  path: string,
  init: RequestInit,
  timeoutMs: number,
) {
  const connection = workerConnection();
  const signal = AbortSignal.timeout(timeoutMs);
  return fetch(`${connection.origin}${path}`, {
    ...init,
    headers: {
      ...Object.fromEntries(new Headers(init.headers)),
      'Content-Type':
        new Headers(init.headers).get('Content-Type') || 'application/json',
      Authorization: `Bearer ${connection.token}`,
    },
    signal: init.signal ? AbortSignal.any([init.signal, signal]) : signal,
    cache: 'no-store',
    redirect: 'error',
  });
}

/** Called only after the existing route's feature and owner/admin checks. */
export async function forwardOfflineDownload(
  request: NextRequest,
): Promise<Response> {
  try {
    const body = ['GET', 'HEAD'].includes(request.method)
      ? undefined
      : await readWorkerBody(request);
    const response = await requestWorker(
      `/v1/offline-download${new URL(request.url).search}`,
      {
        method: request.method,
        body,
        signal: request.signal,
      },
      30_000,
    );
    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type':
          response.headers.get('Content-Type') || 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof WorkerBodyError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    // A timed-out write may already have been accepted; never execute it again in Node.
    return Response.json({ error: 'Go 下载服务暂时不可用' }, { status: 503 });
  }
}

export interface OpenListRootsResult {
  groups: { rootPath: string; folders: OpenListFile[] }[];
  errors: { rootPath: string; error: string }[];
}

export async function scanGoOpenListRoots(input: {
  url: string;
  username: string;
  password: string;
  rootPaths: string[];
}): Promise<OpenListRootsResult> {
  try {
    const response = await requestWorker(
      '/v1/openlist/roots',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      300_000,
    );
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error('Go OpenList 扫描失败');
    }
    const result: OpenListRootsResult = JSON.parse(
      await readLimitedText(response, 32 * 1024 * 1024),
    );
    if (
      !Array.isArray(result.groups) ||
      !Array.isArray(result.errors) ||
      !result.groups.every(
        (group) =>
          input.rootPaths.includes(group.rootPath) &&
          Array.isArray(group.folders) &&
          group.folders.every(
            (folder) =>
              folder &&
              typeof folder.name === 'string' &&
              folder.is_dir === true,
          ),
      ) ||
      !result.errors.every(
        (item) =>
          input.rootPaths.includes(item.rootPath) &&
          typeof item.error === 'string',
      )
    ) {
      throw new Error('Go OpenList 响应无效');
    }
    return result;
  } catch {
    // Credentials and upstream response bodies must never reach logs or clients.
    throw new Error('Go OpenList 扫描服务不可用或返回无效结果');
  }
}
