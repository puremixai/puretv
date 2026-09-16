export async function readCache(_key: string): Promise<string | null> {
  return null;
}
export async function writeCache(
  _key: string,
  _value: string,
  _ttl: number
): Promise<void> {
  /* Local cache only on edge. */
}
export async function consumeSearchRateLimit(_userDigest: string, _cost: number): Promise<{ allowed: boolean; retryAfter: number } | null> {
  return null;
}
