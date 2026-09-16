import { NextRequest, NextResponse } from 'next/server';

import { suwayomiClient } from '@/lib/suwayomi.client';

import { getAuthorizedUsername } from '../../_utils';

export const runtime = 'nodejs';

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function GET(request: NextRequest) {
  const username = await getAuthorizedUsername(request);
  if (username instanceof NextResponse) return username;

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim();
  const sourceId = searchParams.get('sourceId')?.trim() || undefined;
  const page = Number(searchParams.get('page') || '1');

  if (!q) {
    return NextResponse.json({ error: '缺少搜索关键词' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sse(payload)));
        } catch {
          closed = true;
        }
      };

      try {
        const sources = await suwayomiClient.getSearchSources(sourceId);
        let completedSources = 0;
        let totalResults = 0;
        const failedSources: Array<{ sourceId: string; sourceName: string; error: string }> = [];

        send({ type: 'start', totalSources: sources.length });

        await Promise.all(
          sources.map(async (source) => {
            try {
              const result = await suwayomiClient.searchMangaSource(q, source, page);
              completedSources += 1;
              totalResults += result.results.length;
              send({
                type: 'source_result',
                sourceId: String(source.id),
                sourceName: source.displayName || source.name || String(source.id),
                results: result.results,
                completedSources,
                totalSources: sources.length,
              });
            } catch (error) {
              const message = error instanceof Error ? error.message : '未知错误';
              completedSources += 1;
              const failure = {
                sourceId: String(source.id),
                sourceName: source.displayName || source.name || String(source.id),
                error: message,
              };
              failedSources.push(failure);
              send({
                type: 'source_error',
                ...failure,
                completedSources,
                totalSources: sources.length,
              });
            }
          })
        );

        send({
          type: 'complete',
          completedSources,
          totalSources: sources.length,
          totalResults,
          failedSources,
        });
      } catch (error) {
        send({
          type: 'error',
          error: error instanceof Error ? error.message : '搜索失败',
        });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // ignore close races when the client disconnects
        }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
