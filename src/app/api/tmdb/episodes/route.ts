
import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import { getAuthenticatedUser } from '@/lib/session';
import { getTVSeasonDetails } from '@/lib/tmdb.search';

export const runtime = 'nodejs';

/**
 * GET /api/tmdb/episodes?id=xxx&season=xxx
 * 获取电视剧季度的集数详情（带图片）
 */
export async function GET(request: NextRequest) {
  try {
    const authInfo = await getAuthenticatedUser(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const season = searchParams.get('season');

    if (!id || !season) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    const config = await getConfig();
    const tmdbApiKey = config.SiteConfig.TMDBApiKey;
    const tmdbProxy = config.SiteConfig.TMDBProxy;
    const tmdbReverseProxy = config.SiteConfig.TMDBReverseProxy;

    if (!tmdbApiKey) {
      return NextResponse.json({ error: 'TMDB API Key 未配置' }, { status: 400 });
    }

    const response = await getTVSeasonDetails(
      tmdbApiKey,
      parseInt(id),
      parseInt(season),
      tmdbProxy,
      tmdbReverseProxy
    );

    if (response.code !== 200 || !response.season) {
      return NextResponse.json(
        { error: '获取失败', code: response.code },
        { status: response.code }
      );
    }

    return NextResponse.json(response.season);
  } catch (error) {
    logger.error('获取集数详情失败:', error);
    return NextResponse.json(
      { error: '获取失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
