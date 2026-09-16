

import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { refreshLiveChannels } from '@/lib/live';
import { logger } from '@/lib/logger';
import { checkMutationVersion, withConfigMutation } from '@/lib/server/config-mutation';
import { getAuthenticatedUser } from '@/lib/session';

export const runtime = 'nodejs';

export const POST = withConfigMutation(async function POST(request: NextRequest) {
  try {
    // 权限检查 - 使用v2用户系统
    const authInfo = await getAuthenticatedUser(request);
    const username = authInfo?.username;
    const config = await getConfig(true);
    checkMutationVersion(config.ConfigVersion || 0);
    if (username !== process.env.USERNAME) {
      const userInfo = await db.getUserInfoV2(username || '');
      if (!userInfo || userInfo.role !== 'admin' || userInfo.banned) {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
    }

    // 并发刷新所有启用的直播源
    const refreshPromises = (config.LiveConfig || [])
      .filter(liveInfo => !liveInfo.disabled)
      .map(async (liveInfo) => {
        try {
          const nums = await refreshLiveChannels(liveInfo);
          liveInfo.channelNumber = nums;
        } catch {
          liveInfo.channelNumber = 0;
        }
      });

    // 等待所有刷新任务完成
    await Promise.all(refreshPromises);

    // 保存配置
    await db.saveAdminConfig(config);

    return NextResponse.json({
      success: true,
      message: '直播源刷新成功',
    });
  } catch (error) {
    logger.error('直播源刷新失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '刷新失败' },
      { status: 500 }
    );
  }
});
