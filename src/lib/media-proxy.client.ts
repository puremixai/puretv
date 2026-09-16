import { getAuthInfoFromBrowserCookie } from './auth';

let cached: { token: string; expires: number; session: string } | null = null;
let pending: { session: string; promise: Promise<string> } | null = null;

export function getMediaProxyToken(): Promise<string> {
  const auth = getAuthInfoFromBrowserCookie();
  const session = `${auth?.username}:${auth?.tokenId}`;
  if (cached && cached.session === session && cached.expires > Date.now())
    return Promise.resolve(cached.token);
  if (pending?.session === session) return pending.promise;
  const promise = fetch('/api/proxy-token', {
    credentials: 'same-origin',
    cache: 'no-store',
  })
    .then(async (response) => {
      if (!response.ok) throw new Error('无法生成播放授权，请重新登录');
      const data = await response.json();
      if (typeof data.token !== 'string') throw new Error('播放授权响应无效');
      cached = {
        session,
        token: data.token,
        expires: Date.now() + 30 * 60 * 1000,
      };
      return data.token as string;
    })
    .finally(() => {
      if (pending?.promise === promise) pending = null;
    });
  pending = { session, promise };
  return promise;
}
