'use client';

let loadedVersion: number | undefined;
/** The revision belongs to this browser tab and only advances after a config reload. */
export async function adminFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const url = String(input);
  const headers = new Headers(init?.headers);
  if (
    url.startsWith('/api/admin/') &&
    init?.method &&
    init.method.toUpperCase() !== 'GET' &&
    loadedVersion !== undefined &&
    !headers.has('x-config-version')
  )
    headers.set('x-config-version', String(loadedVersion));
  const response = await globalThis.fetch(input, { ...init, headers });
  if (
    url === '/api/admin/config' &&
    (!init?.method || init.method === 'GET') &&
    response.ok
  ) {
    const data = await response.clone().json();
    loadedVersion = data.Config?.ConfigVersion || 0;
  }
  if (response.status === 409 || response.status === 428) {
    const data = await response
      .clone()
      .json()
      .catch(() => ({}));
    throw new Error(data.error || '配置版本冲突，请刷新后重新应用更改。');
  }
  return response;
}
