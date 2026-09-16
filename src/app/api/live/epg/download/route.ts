import { NextRequest, NextResponse } from 'next/server';

import { logger } from '@/lib/logger';
import { isGoWorkerEnabled, requestGoMedia } from '@/lib/server/go-media';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const epgUrl = searchParams.get('url');

    if (!epgUrl) {
      return NextResponse.json({ error: '缺少EPG URL参数' }, { status: 400 });
    }

    logger.debug('[EPG Download] Fetching:', epgUrl);

    if (isGoWorkerEnabled('live')) {
      const response = await requestGoMedia(
        '/v1/live/epg/download',
        { url: epgUrl, ua: 'Mozilla/5.0' },
        request.signal,
      );
      if (!response.ok) {
        void response.body?.cancel();
        return NextResponse.json({ error: 'EPG文件下载失败' }, { status: 500 });
      }
      return new NextResponse(response.body, {
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Content-Disposition': 'attachment; filename="epg.xml"',
        },
      });
    }

    // 获取EPG文件
    const response = await fetch(epgUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'EPG文件下载失败' }, { status: 500 });
    }

    // 检查是否是gzip压缩
    const isGzip =
      epgUrl.endsWith('.gz') ||
      response.headers.get('content-encoding') === 'gzip';

    if (isGzip) {
      logger.debug('[EPG Download] Decompressing gzip...');

      // 读取所有数据
      const reader = response.body?.getReader();
      if (!reader) {
        return NextResponse.json({ error: '无法读取响应' }, { status: 500 });
      }

      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // 合并所有chunks
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const allChunks = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        allChunks.set(chunk, offset);
        offset += chunk.length;
      }

      logger.debug('[EPG Download] Compressed size:', totalLength, 'bytes');

      // 解压
      const zlib = await import('zlib');
      const decompressed = zlib.gunzipSync(Buffer.from(allChunks));
      const decompressedText = decompressed.toString('utf-8');

      logger.debug(
        '[EPG Download] Decompressed size:',
        decompressedText.length,
        'bytes',
      );

      // 返回解压后的XML
      return new NextResponse(decompressedText, {
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Content-Disposition': 'attachment; filename="epg.xml"',
        },
      });
    } else {
      // 非压缩文件，直接返回
      const text = await response.text();
      return new NextResponse(text, {
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Content-Disposition': 'attachment; filename="epg.xml"',
        },
      });
    }
  } catch (error) {
    logger.error('[EPG Download] Error:', error);
    return NextResponse.json({ error: '下载EPG文件失败' }, { status: 500 });
  }
}
