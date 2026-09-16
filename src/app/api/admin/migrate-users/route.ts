import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
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
        error: '不支持本地存储进行数据迁移',
      },
      { status: 400 }
    );
  }

  try {
    const authInfo = await getAuthenticatedUser(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 只有站长可以执行迁移
    if (authInfo.username !== process.env.USERNAME) {
      return NextResponse.json({ error: '权限不足' }, { status: 401 });
    }

    // 获取配置
    const adminConfig = await getConfig(true);
    checkMutationVersion(adminConfig.ConfigVersion || 0);

    // 检查是否有需要迁移的用户（排除站长）
    const usersToMigrate = adminConfig.UserConfig.Users.filter(
      u => u.role !== 'owner'
    );

    if (!usersToMigrate || usersToMigrate.length === 0) {
      return NextResponse.json(
        { error: '没有需要迁移的用户' },
        { status: 400 }
      );
    }

    // 执行迁移
    await db.migrateUsersFromConfig(adminConfig);

    // 迁移完成后，清空配置中的用户列表
    adminConfig.UserConfig.Users = [];
    await db.saveAdminConfig(adminConfig);

    // 更新配置缓存
    const { setCachedConfig } = await import('@/lib/config');
    await setCachedConfig(adminConfig);

    return NextResponse.json(
      { ok: true, message: '用户数据迁移成功' },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    logger.error('用户数据迁移失败:', error);
    return NextResponse.json(
      {
        error: '用户数据迁移失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
});
