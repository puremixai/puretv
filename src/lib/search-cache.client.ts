export const SEARCH_CACHE_MAX_AGE = 5 * 60 * 1000;

// A browser cache key is only a namespace; server permissions remain authoritative.
export function searchCacheKey(
  username: string | undefined,
  query: string,
  special = false,
  privateOnly = false
) {
  if (!username) return null;
  return `search_cache_v2:${JSON.stringify([
    username,
    query.trim(),
    special,
    privateOnly,
  ])}`;
}
