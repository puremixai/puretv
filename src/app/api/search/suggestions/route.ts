import { NextRequest } from 'next/server';

import { AdminConfig } from '@/lib/admin.types';
import { getAvailableApiSites, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { searchJson, startSearch } from '@/lib/server/search-response';
import { yellowWords } from '@/lib/yellow';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const session = await startSearch(request, 1);
  if (session instanceof Response) return session;
  try {
    const query = request.nextUrl.searchParams.get('q')?.trim();
    if (!query) return searchJson({ suggestions: [] });
    const config = await getConfig();
    return searchJson({
      suggestions: await generateSuggestions(
        config,
        query,
        session.username,
        session.scope.signal
      ),
    });
  } catch {
    return searchJson({ error: '获取搜索建议失败' }, 503);
  } finally {
    session.scope.abort();
    session.scope.dispose();
  }
}

async function generateSuggestions(
  config: AdminConfig,
  query: string,
  username: string,
  signal: AbortSignal
): Promise<
  Array<{
    text: string;
    type: 'exact' | 'related' | 'suggestion';
    score: number;
  }>
> {
  const queryLower = query.toLowerCase();

  const apiSites = await getAvailableApiSites(username);
  let realKeywords: string[] = [];

  if (apiSites.length > 0) {
    // 取第一个可用的数据源进行搜索
    const firstSite = apiSites[0];
    const results = await searchFromApi(firstSite, query, signal);

    realKeywords = Array.from(
      new Set(
        results
          .filter(
            (r) =>
              config.SiteConfig.DisableYellowFilter ||
              !yellowWords.some((word: string) =>
                (r.type_name || '').includes(word)
              )
          )
          .map((r) => r.title)
          .filter(Boolean)
          .flatMap((title: string) => title.split(/[ -:：·、-]/))
          .filter(
            (w: string) => w.length > 1 && w.toLowerCase().includes(queryLower)
          )
      )
    ).slice(0, 8);
  }

  // 根据关键词与查询的匹配程度计算分数，并动态确定类型
  const realSuggestions = realKeywords.map((word) => {
    const wordLower = word.toLowerCase();
    const queryWords = queryLower.split(/[ -:：·、-]/);

    // 计算匹配分数：完全匹配得分更高
    let score = 1.0;
    if (wordLower === queryLower) {
      score = 2.0; // 完全匹配
    } else if (
      wordLower.startsWith(queryLower) ||
      wordLower.endsWith(queryLower)
    ) {
      score = 1.8; // 前缀或后缀匹配
    } else if (queryWords.some((qw) => wordLower.includes(qw))) {
      score = 1.5; // 包含查询词
    }

    // 根据匹配程度确定类型
    let type: 'exact' | 'related' | 'suggestion' = 'related';
    if (score >= 2.0) {
      type = 'exact';
    } else if (score >= 1.5) {
      type = 'related';
    } else {
      type = 'suggestion';
    }

    return {
      text: word,
      type,
      score,
    };
  });

  // 按分数降序排列，相同分数按类型优先级排列
  const sortedSuggestions = realSuggestions.sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score; // 分数高的在前
    }
    // 分数相同时，按类型优先级：exact > related > suggestion
    const typePriority = { exact: 3, related: 2, suggestion: 1 };
    return typePriority[b.type] - typePriority[a.type];
  });

  return sortedSuggestions;
}
