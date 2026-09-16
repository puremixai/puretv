import type { NextRequest } from 'next/server';

import { readWorkerBody, requestWorker } from './go-worker';
import { readLimitedText } from './media-body';

/** The caller has already authenticated and checked netdisk_search permission. */
export async function forwardGoNetdisk(
  request: NextRequest,
  action: 'start' | 'task' | 'cancel',
  username: string,
): Promise<Response> {
  let body: Record<string, unknown> | undefined;
  if (action !== 'task') {
    try {
      const rawBody = await readWorkerBody(request);
      if (!rawBody || rawBody.byteLength > 512 * 1024)
        return Response.json({ error: '请求无效' }, { status: 400 });
      const input: unknown = JSON.parse(new TextDecoder().decode(rawBody));
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return Response.json({ error: '请求无效' }, { status: 400 });
      }
      const value = input as Record<string, unknown>;
      body =
        action === 'start'
          ? {
              owner: username,
              platform: String(value.platform || ''),
              links: Array.isArray(value.links)
                ? value.links.map((item) => String(item || ''))
                : [],
            }
          : { owner: username, taskId: String(value.taskId || '') };
      if (action === 'cancel' && !body.taskId)
        return Response.json({ error: '缺少任务ID' }, { status: 400 });
    } catch {
      return Response.json({ error: '请求无效' }, { status: 400 });
    }
  }
  const id = request.nextUrl.searchParams.get('id') || '';
  if (action === 'task' && !id)
    return Response.json({ error: '缺少任务ID' }, { status: 400 });
  const query =
    action === 'task' ? `?${new URLSearchParams({ id, owner: username })}` : '';
  try {
    const response = await requestWorker(
      `/v1/netdisk/check/${action}${query}`,
      {
        method: action === 'task' ? 'GET' : 'POST',
        body: body ? JSON.stringify(body) : undefined,
        signal: request.signal,
      },
      15_000,
    );
    if (response.status >= 500) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error('worker unavailable');
    }
    const result: unknown = JSON.parse(
      await readLimitedText(response, 2 * 1024 * 1024),
    );
    if (!result || typeof result !== 'object' || Array.isArray(result))
      throw new Error('invalid worker response');
    return Response.json(result, {
      status: response.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    // A timed-out submission may already be accepted; never duplicate it in Node.
    return Response.json(
      { error: 'Go 网盘检测服务暂时不可用' },
      { status: 503 },
    );
  }
}
