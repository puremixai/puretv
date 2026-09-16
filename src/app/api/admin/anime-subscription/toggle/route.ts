/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { checkMutationVersion, withConfigMutation } from '@/lib/server/config-mutation';
import { getAuthenticatedUser } from '@/lib/session';

export const runtime = 'nodejs';

const downloadTools = ['aria2', 'qBittorrent', 'Transmission'] as const;
type DownloadTool = typeof downloadTools[number];

function isDownloadTool(tool: unknown): tool is DownloadTool {
  return typeof tool === 'string' && downloadTools.includes(tool as DownloadTool);
}

/**
 * PUT /api/admin/anime-subscription/toggle
 * 切换追番功能启用状态
 */
export const PUT = withConfigMutation(async function PUT(req: NextRequest) {
  try {
    // 权限检查
    const authInfo = await getAuthenticatedUser(req);
    if (!authInfo || (authInfo.role !== 'admin' && authInfo.role !== 'owner')) {
      return NextResponse.json({ error: '无权限访问' }, { status: 403 });
    }

    const { enabled, downloadTool } = await req.json();

    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'enabled 必须是布尔值' },
        { status: 400 }
      );
    }

    if (downloadTool !== undefined && !isDownloadTool(downloadTool)) {
      return NextResponse.json(
        { error: '下载方式不支持' },
        { status: 400 }
      );
    }

    const config = await getConfig(true);
    checkMutationVersion(config.ConfigVersion || 0);
    if (!config.AnimeSubscriptionConfig) {
      config.AnimeSubscriptionConfig = { Enabled: false, Subscriptions: [] };
    }

    config.AnimeSubscriptionConfig.Enabled = enabled;
    if (downloadTool !== undefined) {
      config.AnimeSubscriptionConfig.DownloadTool = downloadTool;
    } else if (!config.AnimeSubscriptionConfig.DownloadTool) {
      config.AnimeSubscriptionConfig.DownloadTool = 'aria2';
    }
    await db.saveAdminConfig(config);

    return NextResponse.json({
      success: true,
      enabled,
      downloadTool: config.AnimeSubscriptionConfig.DownloadTool,
    });
  } catch (error: any) {
    logger.error('切换追番功能状态失败:', error);
    return NextResponse.json(
      { error: error.message || '切换状态失败' },
      { status: 500 }
    );
  }
});
