
import { NextRequest, NextResponse } from 'next/server';

import { getConfig, refineConfig, setCachedConfig } from '@/lib/config';
import {
  applySubscriptionConfig,
  migrateConfigSubscriptions,
  parseSubscriptionConfig,
  validateSubscriptions,
} from '@/lib/config-subscriptions';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { checkMutationVersion, withConfigMutation } from '@/lib/server/config-mutation';
import { getAuthenticatedUser } from '@/lib/session';

export const runtime = 'nodejs';

export const POST = withConfigMutation(async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存储进行管理员配置',
      },
      { status: 400 }
    );
  }

  const authInfo = await getAuthenticatedUser(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const username = authInfo.username;

  try {
    // 检查用户权限
    let adminConfig = structuredClone(await getConfig(true));
    checkMutationVersion(adminConfig.ConfigVersion || 0);
    migrateConfigSubscriptions(adminConfig);

    // 仅站长可以修改配置文件
    if (username !== process.env.USERNAME) {
      return NextResponse.json(
        { error: '权限不足，只有站长可以修改配置文件' },
        { status: 401 }
      );
    }

    // 获取请求体
    const body = await request.json();
    const {
      configFile,
      subscriptions,
      subscriptionUrl,
      autoUpdate,
      lastCheckTime,
    } = body;

    if (!configFile || typeof configFile !== 'string') {
      return NextResponse.json(
        { error: '配置文件内容不能为空' },
        { status: 400 }
      );
    }

    // 验证 JSON 格式
    try {
      parseSubscriptionConfig(configFile);
    } catch {
      return NextResponse.json(
        { error: '配置文件格式错误，请检查 JSON 语法' },
        { status: 400 }
      );
    }

    try {
      if (subscriptions !== undefined) {
        const validated = validateSubscriptions(subscriptions);
        adminConfig = applySubscriptionConfig(
          adminConfig,
          configFile,
          validated
        );
      } else if (subscriptionUrl !== undefined) {
        if ((adminConfig.ConfigSubscriptions?.length || 0) > 1) {
          return NextResponse.json(
            { error: '已启用多订阅，请刷新管理页面后保存' },
            { status: 409 }
          );
        }
        const legacy = subscriptionUrl
          ? validateSubscriptions([
              {
                ID: 'legacy',
                Name: '原有订阅',
                URL: subscriptionUrl,
                Enabled: true,
                AutoUpdate: autoUpdate ?? false,
                LastCheck: lastCheckTime || '',
                ConfigContent: configFile,
              },
            ])
          : [];
        adminConfig = applySubscriptionConfig(
          adminConfig,
          subscriptionUrl ? '{}' : configFile,
          legacy
        );
      } else {
        adminConfig = applySubscriptionConfig(
          adminConfig,
          configFile,
          adminConfig.ConfigSubscriptions || []
        );
      }
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : '配置无效' },
        { status: 400 }
      );
    }

    adminConfig = refineConfig(adminConfig);
    // 更新配置文件
    await db.saveAdminConfig(adminConfig);
    await setCachedConfig(adminConfig);

    // 清除短剧视频源缓存（因为配置文件可能包含新的视频源）
    try {
      await db.deleteGlobalValue('duanju');
      logger.debug('已清除短剧视频源缓存');
    } catch (error) {
      logger.error('清除短剧视频源缓存失败:', error);
      // 不影响主流程，继续执行
    }

    return NextResponse.json({
      success: true,
      message: '配置文件更新成功',
    });
  } catch (error) {
    logger.error('更新配置文件失败:', error);
    return NextResponse.json(
      {
        error: '更新配置文件失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
});
