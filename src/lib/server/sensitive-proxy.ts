import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { fetchPublicUrl, readLimitedText } from '@/lib/server/public-fetch';

import { isMediaProxyAuthorized } from './media-proxy-auth';
import {
  buildProxyM3u8Headers,
  buildProxyStreamHeaders,
} from './proxy-headers';
import { rewriteMediaPlaylist } from './rewrite-m3u8';

export function proxyError(error: string, status: number) {
  return NextResponse.json(
    { error },
    {
      status,
      headers: {
        'Cache-Control': 'private, no-store',
        'CDN-Cache-Control': 'no-store',
        Vary: 'Cookie, Authorization',
      },
    },
  );
}

export async function requireProxyAuth(request: NextRequest) {
  return (await isMediaProxyAuthorized(request))
    ? null
    : proxyError('Unauthorized', 401);
}

export function imageHeaders(contentType: string) {
  return new Headers({
    'Content-Type': contentType,
    'Cache-Control': 'private, max-age=86400',
    'CDN-Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    // SVG images may contain active content when opened as a document.
    'Content-Security-Policy': "default-src 'none'; sandbox",
    Vary: 'Cookie, Authorization',
  });
}

export function isImageContentType(value: string) {
  return /^image\/(?:avif|webp|apng|png|gif|jpe?g|svg\+xml|bmp|x-icon|vnd\.microsoft\.icon)(?:\s*;|$)/i.test(
    value,
  );
}

function liveTrustedOrigins(source: { key: string; url: string }): string[] {
  const origins = [new URL(source.url).origin];
  const configured = process.env.LIVE_PROXY_TRUSTED_ORIGINS;
  if (!configured) return origins;
  // No wildcard or cross-source grant; invalid configuration fails closed.
  const grants = JSON.parse(configured) as Record<string, unknown>;
  const values = Object.prototype.hasOwnProperty.call(grants, source.key)
    ? grants[source.key]
    : [];
  if (!Array.isArray(values) || values.length > 32)
    throw new Error('Invalid live proxy origins');
  for (const value of values) {
    if (typeof value !== 'string') throw new Error('Invalid live proxy origin');
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error('Invalid live proxy origin');
    origins.push(url.origin);
  }
  return origins;
}

export async function handleLiveProxy(
  request: NextRequest,
  kind: 'logo' | 'm3u8' | 'key' | 'segment',
) {
  const denied = await requireProxyAuth(request);
  if (denied) return denied;
  const params = request.nextUrl.searchParams;
  const url = params.get('url');
  if (!url) return proxyError('Missing url', 400);
  let response: Response | undefined;
  let transferred = false;
  try {
    const config = await getConfig();
    const sourceKey = params.get('puretv-source') || params.get('source');
    const liveSource = config.LiveConfig?.find(
      (source) => source.key === sourceKey && !source.disabled,
    );
    if (!liveSource && (kind !== 'logo' || sourceKey))
      return proxyError('Source not found', 404);
    const headers = new Headers({
      'User-Agent': liveSource?.ua || 'AptvPlayer/1.4.10',
    });
    if (kind === 'segment' && request.headers.has('range'))
      headers.set('Range', request.headers.get('range')!);
    response = await fetchPublicUrl(
      url,
      { headers, signal: request.signal },
      {
        trustedOrigins: liveSource ? liveTrustedOrigins(liveSource) : [],
        maxBytes:
          kind === 'key'
            ? 64 * 1024
            : kind === 'logo'
              ? 10 * 1024 * 1024
              : kind === 'm3u8'
                ? undefined // Continuous live streams also enter this route; text is bounded after detection.
                : 64 * 1024 * 1024,
      },
    );
    if (!response.ok) return proxyError('Upstream request failed', 502);
    const contentType = response.headers.get('content-type') || '';
    if (kind === 'logo') {
      if (!isImageContentType(contentType))
        return proxyError('Unsupported image content type', 415);
      transferred = true;
      return new Response(response.body, {
        headers: imageHeaders(contentType),
      });
    }
    if (
      kind === 'm3u8' &&
      (/mpegurl|octet-stream/i.test(contentType) ||
        /\.m3u8?(?:$|[?#])/i.test(response.url))
    ) {
      const content = await readLimitedText(response);
      const playlist = rewriteMediaPlaylist(content, response.url, {
        origin: request.nextUrl.origin,
        source: liveSource!.key,
        token: params.get('token') || undefined,
        mode: 'live',
        proxySegments: params.get('allowCORS') !== 'true',
      });
      return new Response(playlist, {
        headers: buildProxyM3u8Headers(contentType || undefined),
      });
    }
    const outgoing = buildProxyStreamHeaders(
      kind === 'key' ? 'application/octet-stream' : contentType || 'video/mp2t',
    );
    if (response.headers.has('content-range'))
      outgoing.set('Content-Range', response.headers.get('content-range')!);
    if (kind === 'key')
      return new Response(await response.arrayBuffer(), { headers: outgoing });
    transferred = true;
    return new Response(response.body, {
      status: response.status,
      headers: outgoing,
    });
  } catch {
    return proxyError('Proxy request failed', 502);
  } finally {
    if (!transferred && response?.body && !response.body.locked)
      await response.body.cancel().catch(() => undefined);
  }
}
