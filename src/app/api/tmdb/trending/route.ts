import { NextResponse } from 'next/server';

import { logger } from '@/lib/logger';
import { BannerDataError, getBannerData } from '@/lib/server/banner-data';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await getBannerData());
  } catch (error) {
    if (error instanceof BannerDataError) {
      return NextResponse.json(error.body, { status: error.status });
    }
    logger.error('获取热门内容失败:', error);
    return NextResponse.json(
      { code: 500, message: '获取热门内容失败' },
      { status: 500 }
    );
  }
}
