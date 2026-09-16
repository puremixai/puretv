/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { isMediaProxyAuthorized } from '@/lib/server/media-proxy-auth';
import { buildProxyStreamHeaders } from '@/lib/server/proxy-headers';
import { fetchPublicUrl } from '@/lib/server/public-fetch';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  if (!(await isMediaProxyAuthorized(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const source = searchParams.get('source');

  if (!url) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  }

  if (!source) {
    return NextResponse.json({ error: 'Missing source' }, { status: 400 });
  }

  // 定义直链播放模式常量
  const DIRECT_PLAY_SOURCE = 'directplay';

  // 直链播放模式：跳过源站配置检查，直接代理
  if (source !== DIRECT_PLAY_SOURCE) {
    // 检查该视频源是否启用了代理模式
    const config = await getConfig();
    const videoSource = config.SourceConfig?.find((s: any) => s.key === source);

    if (!videoSource) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 });
    }

    if (!videoSource.proxyMode) {
      return NextResponse.json({ error: 'Proxy mode not enabled for this source' }, { status: 403 });
    }
  }

  let response: Response | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  try {
    const decodedUrl = url; // URLSearchParams already decoded the outer parameter.

    // 安全校验：防 SSRF 拦截请求内网或非法 URL (强制检查所有代理请求)

    response = await fetchPublicUrl(decodedUrl, {
      signal: request.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': decodedUrl,
      },
    });
    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch segment' }, { status: 500 });
    }

    const headers = buildProxyStreamHeaders(
      response.headers.get('Content-Type') || 'video/mp2t',
      response.headers.get('content-length')
    );

    // 使用流式传输，避免占用内存
    let isCancelled = false;

    const stream = new ReadableStream({
      start(controller) {
        if (!response?.body) {
          controller.close();
          return;
        }

        reader = response.body.getReader();

        function pump() {
          if (isCancelled || !reader) {
            return;
          }

          reader.read().then(({ done, value }) => {
            if (isCancelled) {
              return;
            }

            if (done) {
              controller.close();
              cleanup();
              return;
            }

            controller.enqueue(value);
            pump();
          }).catch((error) => {
            if (!isCancelled) {
              controller.error(error);
              cleanup();
            }
          });
        }

        function cleanup() {
          if (reader) {
            try {
              reader.releaseLock();
            } catch {
              // reader 可能已经被释放，忽略错误
            }
            reader = null;
          }
        }

        pump();
      },
      cancel() {
        isCancelled = true;
        // 当流被取消时，确保释放所有资源
        if (reader) {
          try {
            reader.releaseLock();
          } catch {
            // reader 可能已经被释放，忽略错误
          }
          reader = null;
        }

        if (response?.body) {
          try {
            response.body.cancel();
          } catch {
            // 忽略取消时的错误
          }
        }
      }
    });

    return new Response(stream, { headers });
  } catch {
    // 确保在错误情况下也释放资源
    if (reader) {
      try {
        (reader as ReadableStreamDefaultReader<Uint8Array>).releaseLock();
      } catch {
        // 忽略错误
      }
    }

    if (response?.body) {
      try {
        response.body.cancel();
      } catch {
        // 忽略错误
      }
    }

    return NextResponse.json({ error: 'Failed to fetch segment' }, { status: 500 });
  }
}
