import { createHash } from 'crypto';

import { readCache, writeCache } from '@/lib/cache-backend';
import { SearchResult } from '@/lib/types';

export type CachedPageStatus = 'ok' | 'timeout' | 'forbidden';
export interface CachedPageEntry {
  expiresAt: number;
  status: CachedPageStatus;
  data: SearchResult[];
  pageCount?: number;
}

const MAX_CACHE_SIZE = 1000;
const MAX_CACHE_BYTES = 8 * 1024 * 1024;
const entries = new Map<string, string>();
let bytes = 0;

function cacheKey(source: string, query: string, page: number): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([source, query.trim(), page]))
    .digest('hex');
  return `${
    process.env.CACHE_KEY_PREFIX || 'puretv:cache'
  }:search:v2:${digest}`;
}

function remember(key: string, value: string) {
  const size = Buffer.byteLength(value, 'utf8');
  if (size > 1024 * 1024) return;
  forget(key);
  entries.set(key, value);
  bytes += size;
  while (entries.size > MAX_CACHE_SIZE || bytes > MAX_CACHE_BYTES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    forget(oldest);
  }
}

function forget(key: string) {
  const old = entries.get(key);
  if (old) bytes -= Buffer.byteLength(old, 'utf8');
  entries.delete(key);
}

function decode(value: string | null | undefined): CachedPageEntry | null {
  if (!value) return null;
  try {
    const entry = JSON.parse(value) as CachedPageEntry;
    if (
      !Number.isFinite(entry.expiresAt) ||
      entry.expiresAt <= Date.now() ||
      !['ok', 'timeout', 'forbidden'].includes(entry.status) ||
      !Array.isArray(entry.data)
    )
      return null;
    return entry;
  } catch {
    return null;
  }
}

export async function getCachedSearchPage(
  source: string,
  query: string,
  page: number
): Promise<CachedPageEntry | null> {
  const key = cacheKey(source, query, page);
  const remote = await readCache(key);
  const entry = decode(remote);
  if (entry && remote) {
    remember(key, remote);
    return entry;
  }
  const local = entries.get(key);
  const fallback = decode(local);
  if (fallback && local) remember(key, local);
  else forget(key);
  // JSON decoding gives callers their own copy; pagination cannot mutate cached pages.
  return fallback;
}

export async function setCachedSearchPage(
  source: string,
  query: string,
  page: number,
  status: CachedPageStatus,
  data: SearchResult[],
  pageCount?: number
): Promise<void> {
  const ttl = status === 'ok' ? 10 * 60 * 1000 : 30 * 1000;
  const key = cacheKey(source, query, page);
  const value = JSON.stringify({
    expiresAt: Date.now() + ttl,
    status,
    data,
    pageCount,
  });
  remember(key, value);
  await writeCache(key, value, ttl);
}
