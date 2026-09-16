
import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import { getAuthenticatedUser } from '@/lib/session';
import { getTVSeasons } from '@/lib/tmdb.search';

export const runtime = 'nodejs';

/**
 * GET /api/tmdb/seasons?tvId=xxx
 * 获取电视剧的季度列表
 */
export async function GET(request: NextRequest) {
  try {
    const authInfo = await getAuthenticatedUser(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const tvIdStr = searchParams.get('tvId');

    if (!tvIdStr) {
      return NextResponse.json({ error: '缺少 tvId 参数' }, { status: 400 });
    }

    const tvId = parseInt(tvIdStr, 10);
    if (isNaN(tvId)) {
      return NextResponse.json({ error: 'tvId 必须是数字' }, { status: 400 });
    }

    const config = await getConfig();
    const tmdbApiKey = config.SiteConfig.TMDBApiKey;
    const tmdbProxy = config.SiteConfig.TMDBProxy;
    const tmdbReverseProxy = config.SiteConfig.TMDBReverseProxy;

    if (!tmdbApiKey) {
      return NextResponse.json(
        { error: 'TMDB API Key 未配置' },
        { status: 400 }
      );
    }

    const result = await getTVSeasons(tmdbApiKey, tvId, tmdbProxy, tmdbReverseProxy);

    if (result.code === 200 && result.seasons) {
      return NextResponse.json({
        success: true,
        seasons: result.seasons,
      });
    } else {
      return NextResponse.json(
        { error: '获取季度列表失败', code: result.code },
        { status: result.code }
      );
    }
  } catch (error) {
    logger.error('获取季度列表失败:', error);
    return NextResponse.json(
      { error: '获取失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
