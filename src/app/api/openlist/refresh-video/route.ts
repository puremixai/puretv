

import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import { invalidateVideoInfoCache } from '@/lib/openlist-cache';
import { requireFeaturePermission } from '@/lib/permissions';
import { getAuthenticatedUser } from '@/lib/session';

export const runtime = 'nodejs';

/**
 * POST /api/openlist/refresh-video
 * 刷新单个视频的 videoinfo.json
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(request, 'private_library', '无权限访问私人影库');
    if (authResult instanceof NextResponse) return authResult;
    const authInfo = await getAuthenticatedUser(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const body = await request.json();
    const { folder } = body;

    if (!folder) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    const config = await getConfig();
    const openListConfig = config.OpenListConfig;

    if (
      !openListConfig ||
      !openListConfig.Enabled ||
      !openListConfig.URL ||
      !openListConfig.Username ||
      !openListConfig.Password
    ) {
      return NextResponse.json({ error: 'OpenList 未配置或未启用' }, { status: 400 });
    }

    // folder 已经是完整路径，直接使用
    const folderPath = folder;
    // 清除缓存
    invalidateVideoInfoCache(folderPath);

    return NextResponse.json({
      success: true,
      message: '刷新成功',
    });
  } catch (error) {
    logger.error('刷新视频失败:', error);
    return NextResponse.json(
      { error: '刷新失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
