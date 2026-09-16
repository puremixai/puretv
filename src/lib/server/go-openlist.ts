import { requestWorker } from './go-worker';

export async function executeGoOpenList(
  baseURL: string,
  username: string,
  password: string,
  url: string,
  options: RequestInit,
): Promise<Response> {
  const base = baseURL.replace(/\/+$/, '');
  if (!url.startsWith(`${base}/api/`)) throw new Error('OpenList 操作地址无效');
  const headers = new Headers(options.headers);
  const forwarded: Record<string, string> = {};
  for (const name of ['content-type', 'file-path', 'as-task']) {
    const value = headers.get(name);
    if (value !== null) forwarded[name] = value;
  }
  try {
    return await requestWorker(
      '/v1/openlist/operations',
      {
        method: 'POST',
        signal: options.signal,
        body: JSON.stringify({
          url: base,
          username,
          password,
          path: url.slice(base.length),
          method: options.method || 'GET',
          body: options.body || '',
          headers: forwarded,
        }),
      },
      65_000,
    );
  } catch {
    throw new Error('Go OpenList 服务不可用');
  }
}
