import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { consumeSearchRateLimit } from '@/lib/cache-backend';
import { getAuthenticatedUser } from '@/lib/session';

import { searchScope } from './search-control';

export const privateSearchHeaders = {
  'Cache-Control': 'private, no-store',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
  Vary: 'Cookie, Authorization',
};
export function searchJson(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {}
) {
  return NextResponse.json(data, {
    status,
    headers: { ...privateSearchHeaders, ...headers },
  });
}
const key = Symbol.for('puretv.search.local-rates');
const registry = globalThis as typeof globalThis & {
  [key]?: Map<string, { count: number; until: number }>;
};
const fallback = registry[key] || (registry[key] = new Map());

// One-source/suggestion requests cost one token, a full search costs six.
// Redis shares the 120-token/minute budget; a bounded local fallback preserves availability.
export async function startSearch(request: NextRequest, cost = 6) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (!auth?.username) return searchJson({ error: 'Unauthorized' }, 401);
    if ((request.nextUrl.searchParams.get('q') || '').length > 200)
      return searchJson({ error: '搜索关键词最多 200 个字符' }, 400);
    const digest = createHash('sha256').update(auth.username).digest('hex');
    const now = Date.now();
    let budget = cost
      ? await consumeSearchRateLimit(digest, cost)
      : { allowed: true, retryAfter: 0 };
    if (!budget) {
      for (const [id, record] of Array.from(fallback.entries()))
        if (record.until <= now) fallback.delete(id);
      if (!fallback.has(digest) && fallback.size >= 10000)
        return searchJson({ error: '搜索繁忙，请稍后重试' }, 429, {
          'Retry-After': '60',
        });
      const record = fallback.get(digest) || { count: 0, until: now + 60000 };
      const allowed = record.count + cost <= 120;
      if (allowed) record.count += cost;
      fallback.set(digest, record);
      budget = {
        allowed,
        retryAfter: Math.max(1, Math.ceil((record.until - now) / 1000)),
      };
    }
    if (!budget.allowed)
      return searchJson({ error: '搜索过于频繁，请稍后重试' }, 429, {
        'Retry-After': String(budget.retryAfter),
      });
    return { username: auth.username, scope: searchScope(request.signal) };
  } catch {
    return searchJson({ error: '搜索服务暂时不可用' }, 503);
  }
}
