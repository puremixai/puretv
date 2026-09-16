/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";

import { getConfig } from "@/lib/config";
import { logger } from '@/lib/logger';
import { isMediaProxyAuthorized } from '@/lib/server/media-proxy-auth';
import { buildProxyM3u8Headers, buildProxyStreamHeaders } from '@/lib/server/proxy-headers';
import { fetchPublicUrl, readLimitedText } from '@/lib/server/public-fetch';
import { rewriteMediaPlaylist } from '@/lib/server/rewrite-m3u8';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  if (!(await isMediaProxyAuthorized(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const source = searchParams.get('source'); // 视频源key

  if (!url) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  }

  if (!source) {
    return NextResponse.json({ error: 'Missing source' }, { status: 400 });
  }

  // 检查该视频源是否启用了代理模式
  const config = await getConfig();
  const videoSource = config.SourceConfig?.find((s: any) => s.key === source);

  if (!videoSource) {
    return NextResponse.json({ error: 'Source not found' }, { status: 404 });
  }

  if (!videoSource.proxyMode) {
    return NextResponse.json({ error: 'Proxy mode not enabled for this source' }, { status: 403 });
  }

  let response: Response | null = null;
  let responseUsed = false;

  try {
    const decodedUrl = url; // URLSearchParams already decoded the outer parameter.

    // 安全校验：防 SSRF 拦截请求内网或非法 URL

    response = await fetchPublicUrl(decodedUrl, {
      signal: request.signal,
      cache: 'no-cache',
      redirect: 'follow',
      credentials: 'same-origin',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': decodedUrl,
      },
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch m3u8' }, { status: 500 });
    }

    const contentType = response.headers.get('Content-Type') || '';
    // rewrite m3u8
    if (contentType.toLowerCase().includes('mpegurl') || contentType.toLowerCase().includes('octet-stream') || decodedUrl.includes('.m3u8')) {
      // 获取最终的响应URL（处理重定向后的URL）
      const finalUrl = response.url;
      const m3u8Content = await readLimitedText(response);
      responseUsed = true; // 标记 response 已被使用

      // 使用最终的响应URL作为baseUrl，而不是原始的请求URL
      const baseUrl = finalUrl;

      // 重写 M3U8 内容
      const modifiedContent = rewriteM3U8Content(m3u8Content, baseUrl, request, source);

      const headers = buildProxyM3u8Headers(contentType || undefined);
      return new Response(modifiedContent, { headers });
    }
    // just proxy
    const headers = buildProxyStreamHeaders(
      response.headers.get('Content-Type') || 'application/vnd.apple.mpegurl'
    );
    headers.set('Cache-Control', 'private, no-store');

    responseUsed = true; // Ownership of the stream moves to the response.
    // 直接返回视频流
    return new Response(response.body, {
      status: 200,
      headers,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch m3u8' }, { status: 500 });
  } finally {
    // 确保 response 被正确关闭以释放资源
    if (response && !responseUsed) {
      try {
        response.body?.cancel();
      } catch (error) {
        // 忽略关闭时的错误
        logger.warn('Failed to close response body:', error);
      }
    }
  }
}

function rewriteM3U8Content(content: string, baseUrl: string, req: Request, source: string) {
  const requestUrl = new URL(req.url);
  return rewriteMediaPlaylist(content, baseUrl, { origin: requestUrl.origin, source, token: requestUrl.searchParams.get('token') || '', mode: 'vod', proxySegments: true });
}
