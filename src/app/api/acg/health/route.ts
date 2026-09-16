/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import {
  getMagnetHealthConcurrency,
  MagnetHealthBusyError,
  probeMagnetHealth,
} from '@/lib/magnet-health';
import { hasFeaturePermission } from '@/lib/permissions';
import { getAuthenticatedUser } from '@/lib/session';

export const runtime = 'nodejs';

/**
 * POST /api/acg/health
 * 单条磁力/种子 Tracker scrape 测活（动漫磁链搜索 / 网盘搜索磁力类型共用）
 * body: { url: string, skipCache?: boolean }
 * 全站同时测活上限：环境变量 MAGNET_HEALTH_MAX_CONCURRENT（默认 10）
 */
export async function POST(req: NextRequest) {
  try {
    const authInfo = await getAuthenticatedUser(req);
    if (!authInfo?.username) {
      return NextResponse.json({ error: '无权限访问' }, { status: 403 });
    }

    const canUse =
      (await hasFeaturePermission(authInfo.username, 'magnet_search')) ||
      (await hasFeaturePermission(authInfo.username, 'netdisk_search'));
    if (!canUse) {
      return NextResponse.json({ error: '无权限访问' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    const skipCache = Boolean(body?.skipCache);

    if (!url) {
      return NextResponse.json({ error: '链接不能为空' }, { status: 400 });
    }

    // 粗限长度，避免乱丢超大 body
    if (url.length > 8192) {
      return NextResponse.json({ error: '链接过长' }, { status: 400 });
    }

    const config = await getConfig();
    const result = await probeMagnetHealth({
      url,
      proxy: config.SiteConfig.MagnetProxy || undefined,
      skipCache,
    });

    return NextResponse.json({
      success: true,
      ...result,
      concurrency: getMagnetHealthConcurrency(),
    });
  } catch (error: any) {
    if (error instanceof MagnetHealthBusyError || error?.code === 'MAGNET_HEALTH_BUSY') {
      return NextResponse.json(
        {
          error: error.message || '测活繁忙，请稍后再试',
          code: 'MAGNET_HEALTH_BUSY',
          concurrency: getMagnetHealthConcurrency(),
        },
        { status: 429 }
      );
    }

    logger.error('磁力测活失败:', error);
    return NextResponse.json(
      { error: error?.message || '测活失败' },
      { status: 500 }
    );
  }
}
