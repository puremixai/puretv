
import { NextResponse } from 'next/server';

import { getCacheTime } from '@/lib/config';
import { getDuanjuSources } from '@/lib/duanju';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * 获取包含短剧分类的视频源列表
 */
export async function GET() {
  try {
    const sources = await getDuanjuSources();
    const cacheTime = await getCacheTime();

    return NextResponse.json(
      {
        code: 200,
        message: '获取成功',
        data: sources,
      },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        },
      }
    );
  } catch (error) {
    logger.error('获取短剧视频源失败:', error);
    return NextResponse.json(
      {
        code: 500,
        message: '获取短剧视频源失败',
        error: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
