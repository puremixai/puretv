import { NextRequest } from 'next/server';

import { getConfig } from '@/lib/config';
import { fetchPublicUrl } from '@/lib/server/public-fetch';
import {
  imageHeaders,
  isImageContentType,
  proxyError,
  requireProxyAuth,
} from '@/lib/server/sensitive-proxy';

export const runtime = 'nodejs';

function isBangumiImageUrl(input: string): boolean {
  try {
    const url = new URL(input);
    const hostname = url.hostname.toLowerCase();
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.port &&
      (hostname === 'lain.bgm.tv' ||
        hostname === 'r.bgm.tv' ||
        hostname === 'bangumi.lol' ||
        hostname.endsWith('.bgm.tv') ||
        hostname.endsWith('.bangumi.tv') ||
        hostname.endsWith('.bangumi.lol'))
    );
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const denied = await requireProxyAuth(request);
  if (denied) return denied;
  const imageUrl = request.nextUrl.searchParams.get('url');
  if (!imageUrl) return proxyError('Missing image URL', 400);
  let response: Response | undefined;
  let transferred = false;
  try {
    // The caller's source=bangumi label alone never grants a trusted proxy or LAN origin.
    const bangumi = isBangumiImageUrl(imageUrl);
    const site = bangumi ? (await getConfig()).SiteConfig : undefined;
    const base = site?.BangumiImageBaseUrl?.trim().replace(/\/+$/, '');
    const target = base ? `${base}/${imageUrl}` : imageUrl;
    response = await fetchPublicUrl(
      target,
      {
        signal: request.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          Accept:
            'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          Referer: bangumi ? 'https://bgm.tv/' : 'https://movie.douban.com/',
        },
      },
      {
        trustedOrigins: base ? [new URL(base).origin] : [],
        proxyUrl: site?.BangumiProxy?.trim() || undefined,
        maxBytes: 10 * 1024 * 1024,
        timeoutMs: 15_000,
      },
    );
    if (!response.ok) return proxyError('Upstream image request failed', 502);
    const contentType = response.headers.get('content-type') || '';
    if (!isImageContentType(contentType))
      return proxyError('Unsupported image content type', 415);
    if (!response.body) return proxyError('Image response has no body', 502);
    transferred = true;
    return new Response(response.body, { headers: imageHeaders(contentType) });
  } catch {
    return proxyError('Error fetching image', 502);
  } finally {
    if (!transferred && response?.body && !response.body.locked)
      await response.body.cancel().catch(() => undefined);
  }
}
