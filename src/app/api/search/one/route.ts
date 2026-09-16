import { NextRequest } from 'next/server';

import { buildSearchPlan, runSearchPlan } from '@/lib/server/search-plan';
import { searchJson, startSearch } from '@/lib/server/search-response';
import { SearchResult } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// OrionTV compatibility: retain the results shape and exact-title matching.
export async function GET(request: NextRequest) {
  const session = await startSearch(request, 1);
  if (session instanceof Response) return session;
  const { scope, username } = session;
  try {
    const query = request.nextUrl.searchParams.get('q')?.trim();
    const resourceId = request.nextUrl.searchParams.get('resourceId');
    if (!query || !resourceId)
      return searchJson(
        { result: null, error: '缺少必要参数: q 或 resourceId' },
        400
      );
    const plan = await buildSearchPlan(request, username, query, resourceId);
    const results: SearchResult[] = [];
    await runSearchPlan(plan, scope.signal, (event) =>
      results.push(...event.results)
    );
    const matches = results.filter((item) => item.title === query);
    return matches.length
      ? searchJson({ results: matches })
      : searchJson({ result: null, error: '未找到结果' }, 404);
  } catch {
    return searchJson({ result: null, error: '搜索服务暂时不可用' }, 503);
  } finally {
    scope.abort();
    scope.dispose();
  }
}
