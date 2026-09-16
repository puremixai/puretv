import { NextRequest } from 'next/server';

import { buildSearchPlan, runSearchPlan } from '@/lib/server/search-plan';
import { searchJson, startSearch } from '@/lib/server/search-response';
import { SearchResult } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await startSearch(request);
  if (session instanceof Response) return session;
  const { scope, username } = session;
  try {
    const query = request.nextUrl.searchParams.get('q')?.trim();
    if (!query) return searchJson({ results: [] });
    const plan = await buildSearchPlan(request, username, query);
    const results: SearchResult[] = [];
    try {
      await runSearchPlan(plan, scope.signal, (event) =>
        results.push(...event.results)
      );
    } catch (error) {
      if (!scope.signal.aborted) throw error;
    }
    results.sort((a, b) => (b.weight || 0) - (a.weight || 0));
    return searchJson({ results, partial: scope.signal.aborted });
  } catch {
    return searchJson({ error: '搜索服务暂时不可用' }, 503);
  } finally {
    scope.abort();
    scope.dispose();
  }
}
