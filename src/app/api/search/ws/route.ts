import { NextRequest } from 'next/server';

import { buildSearchPlan, runSearchPlan } from '@/lib/server/search-plan';
import {
  privateSearchHeaders,
  searchJson,
  startSearch,
} from '@/lib/server/search-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await startSearch(request);
  if (session instanceof Response) return session;
  const { scope, username } = session;
  try {
    const query = request.nextUrl.searchParams.get('q')?.trim();
    if (!query) {
      scope.dispose();
      return searchJson({ error: '搜索关键词不能为空' }, 400);
    }
    const plan = await buildSearchPlan(request, username, query);
    let closed = false;
    const stream = new ReadableStream<Uint8Array>(
      {
        async start(controller) {
          const encoder = new TextEncoder();
          const emit = (event: object) => {
            if (closed) return;
            try {
              // Stop upstream work if a disconnected/slow client is no longer consuming.
              if ((controller.desiredSize ?? 0) < 0) {
                closed = true;
                scope.abort();
                controller.close();
                return;
              }
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    ...event,
                    timestamp: Date.now(),
                  })}\n\n`
                )
              );
            } catch {
              closed = true;
              scope.abort();
            }
          };
          let completedSources = 0,
            totalResults = 0;
          try {
            emit({ type: 'start', query, totalSources: plan.tasks.length });
            await runSearchPlan(plan, scope.signal, (event) => {
              completedSources++;
              totalResults += event.results.length;
              emit(event);
            });
          } catch {
            // Completed results remain usable when the overall deadline is reached.
          } finally {
            if (!closed) {
              emit({
                type: 'complete',
                completedSources,
                totalResults,
                partial: scope.signal.aborted,
              });
              if (!closed) {
                closed = true;
                controller.close();
              }
            }
            scope.abort();
            scope.dispose();
          }
        },
        cancel() {
          closed = true;
          scope.abort();
          scope.dispose();
        },
      },
      { highWaterMark: 1024 * 1024, size: (chunk) => chunk.byteLength }
    );
    return new Response(stream, {
      headers: {
        ...privateSearchHeaders,
        'Content-Type': 'text/event-stream',
        'X-Accel-Buffering': 'no',
        Connection: 'keep-alive',
      },
    });
  } catch {
    scope.abort();
    scope.dispose();
    return searchJson({ error: '搜索服务暂时不可用' }, 503);
  }
}
