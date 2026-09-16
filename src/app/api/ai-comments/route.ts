import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { AIConfigurationError } from '@/lib/ai-model-config';
import { getConfig } from '@/lib/config';
import {
  enqueueAIComments,
  readSavedAIComments,
} from '@/lib/server/ai-comments';
import { getAuthenticatedUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const input = z.object({
  name: z.string().trim().min(1, '缺少影片名称参数').max(300),
  year: z.string().trim().max(16).default(''),
  info: z.string().max(4000).default(''),
  count: z.number().int().min(1).max(50).default(10),
  regenerate: z.boolean().default(false),
});

const json = (value: unknown, status = 200) =>
  NextResponse.json(value, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });

async function handle(request: NextRequest, submit: boolean) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (!auth?.username) return json({ error: 'Unauthorized' }, 401);
    const canGenerate = auth.role === 'admin' || auth.role === 'owner';
    if (submit && !canGenerate)
      return json(
        { error: '仅管理员和站长可以生成 AI 评论', canGenerate: false },
        403
      );
    const origin = request.headers.get('origin');
    // The custom server's nextUrl can contain its internal Docker port.
    // Host preserves the browser-facing authority; TLS proxies supply protocol.
    const host = request.headers.get('host') || request.nextUrl.host;
    const protocol =
      request.headers.get('x-forwarded-proto')?.split(',')[0].trim() ||
      request.nextUrl.protocol.replace(':', '');
    const expectedOrigin = `${protocol}://${host}`;
    if (
      submit &&
      (request.headers.get('sec-fetch-site') === 'cross-site' ||
        (origin && origin !== expectedOrigin))
    ) {
      return json({ error: '不允许跨站提交生成任务' }, 403);
    }
    if (process.env.NEXT_PUBLIC_STORAGE_TYPE !== 'postgres')
      return json({ error: '保存 AI 评论需要 PostgreSQL 存储' }, 503);
    const search = request.nextUrl.searchParams;
    const data = input.safeParse(
      submit
        ? await request.json()
        : {
            name: search.get('name'),
            year: search.get('year') || '',
            count: Number(search.get('count') ?? '10'),
          }
    );
    if (!data.success)
      return json({ error: '影片参数无效，评论数量须为 1–50 的整数' }, 400);
    const config = await getConfig();
    if (!config.AIConfig?.Enabled || !config.AIConfig.EnableAIComments)
      return json({ error: 'AI评论功能未启用' }, 403);
    const { regenerate, ...movie } = data.data;
    const result = submit
      ? await enqueueAIComments(auth.username, movie, regenerate)
      : await readSavedAIComments(movie);
    return json(
      canGenerate
        ? { ...result, canGenerate }
        : {
            status: result.status,
            comments: result.comments,
            total: result.total,
            movieName: result.movieName,
            generatedAt: result.generatedAt,
            isAiGenerated: true,
            canGenerate: false,
          },
      submit && ['queued', 'running'].includes(result.status) ? 202 : 200
    );
  } catch (error) {
    if (error instanceof SyntaxError)
      return json({ error: '请求格式错误' }, 400);
    if (error instanceof AIConfigurationError)
      return json({ error: error.message }, 400);
    if ((error as { code?: string })?.code === 'AI_QUEUE_FULL')
      return json({ error: (error as Error).message }, 429);
    return json({ error: 'AI评论任务暂时无法读写，请稍后重试' }, 500);
  }
}

export const GET = (request: NextRequest) => handle(request, false);
export const POST = (request: NextRequest) => handle(request, true);
