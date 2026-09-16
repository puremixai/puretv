
import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import { startOpenListRefresh } from '@/lib/openlist-refresh';
import { requireFeaturePermission } from '@/lib/permissions';
import { getAuthenticatedUser } from '@/lib/session';

export const runtime = 'nodejs';

/**
 * POST /api/openlist/refresh
 * 刷新私人影库元数据（后台任务模式）
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(request, 'private_library', '无权限访问私人影库');
    if (authResult instanceof NextResponse) return authResult;
    // 权限检查
    const authInfo = await getAuthenticatedUser(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    // 检查 TMDB API Key 是否配置
    const config = await getConfig();
    if (!config.SiteConfig.TMDBApiKey || config.SiteConfig.TMDBApiKey.trim() === '') {
      return NextResponse.json(
        { error: '请先在站点配置中配置 TMDB API Key' },
        { status: 400 }
      );
    }

    // 获取请求参数
    const body = await request.json().catch(() => ({}));
    const clearMetaInfo = body.clearMetaInfo === true;

    // 启动扫描任务
    const { taskId } = await startOpenListRefresh(clearMetaInfo);

    return NextResponse.json({
      success: true,
      taskId,
      message: '扫描任务已启动',
    });
  } catch (error) {
    logger.error('启动刷新任务失败:', error);
    return NextResponse.json(
      { error: '启动失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
