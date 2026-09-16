/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import {
  addOpenListOfflineDownload,
  getOfflineDownloadBasePath,
  joinOpenListPath,
} from '@/lib/openlist-offline-download';
import { hasFeaturePermission } from '@/lib/permissions';
import { getAuthenticatedUser } from '@/lib/session';

export const runtime = 'nodejs';

const downloadTools = ['aria2', 'Transmission', 'qBittorrent'] as const;
type DownloadTool = typeof downloadTools[number];

function isDownloadTool(tool: unknown): tool is DownloadTool {
  return typeof tool === 'string' && downloadTools.includes(tool as DownloadTool);
}

/**
 * POST /api/acg/download
 * 添加 ACG 资源到 OpenList 离线下载（仅管理员和站长可用）
 */
export async function POST(req: NextRequest) {
  try {
    // 检查权限
    const authInfo = await getAuthenticatedUser(req);
    if (!authInfo?.username || !(await hasFeaturePermission(authInfo.username, 'magnet_save_private_library'))) {
      return NextResponse.json(
        { error: '无权限访问' },
        { status: 403 }
      );
    }

    const { url, name, tool = 'aria2' } = await req.json();

    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { error: '下载链接不能为空' },
        { status: 400 }
      );
    }

    if (!name || typeof name !== 'string') {
      return NextResponse.json(
        { error: '资源名称不能为空' },
        { status: 400 }
      );
    }

    if (!isDownloadTool(tool)) {
      return NextResponse.json(
        { error: '下载方式不支持' },
        { status: 400 }
      );
    }

    // 获取 OpenList 配置
    const config = await getConfig();

    // 构建下载路径（使用离线下载目录）
    const downloadPath = joinOpenListPath(
      getOfflineDownloadBasePath(config),
      name
    );
    await addOpenListOfflineDownload(config, downloadPath, url, tool);

    return NextResponse.json({
      success: true,
      message: '已添加到离线下载队列',
      path: downloadPath,
    });

  } catch (error: any) {
    logger.error('添加离线下载任务失败:', error);
    return NextResponse.json(
      { error: error.message || '添加离线下载任务失败' },
      { status: 500 }
    );
  }
}
