import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { checkSource, readSourceHealth } from '@/lib/server/source-health';
import { getAuthenticatedUser } from '@/lib/session';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedUser(request);
  if (!auth?.username) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (auth.username !== process.env.USERNAME) {
    const user = await db.getUserInfoV2(auth.username);
    if (!user || user.banned || user.role !== 'admin') return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }
  if (request.headers.get('sec-fetch-site') === 'cross-site') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sources = (await getConfig()).SourceConfig;
  const keyword = request.nextUrl.searchParams.get('q')?.trim();
  if (!keyword) return NextResponse.json({ health: Object.fromEntries(await Promise.all(sources.map(async source => [source.key, await readSourceHealth(source)]))) });
  if (keyword.length > 100) return NextResponse.json({ error: '搜索词过长' }, { status: 400 });
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (data: unknown) => { if (!closed) controller.enqueue(encoder.encode('data: ' + JSON.stringify(data) + '\n\n')); };
      const queue = [...sources]; let completed = 0;
      try {
        send({ type: 'start', totalSources: sources.length });
        await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
          for (;;) { if (closed) return; const source = queue.shift(); if (!source) return;
            try { const health = await checkSource(source, keyword); send({ type: 'source_result', source: source.key, ...health }); }
            catch { send({ type: 'source_error', source: source.key, status: 'invalid', message: '检测结果保存失败' }); }
            completed++;
          }
        }));
        send({ type: 'complete', completedSources: completed });
      } finally { if (!closed) { closed = true; controller.close(); } }
    },
    cancel() { closed = true; },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } });
}
