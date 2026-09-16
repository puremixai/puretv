

import { NextRequest, NextResponse } from 'next/server';

import { AdminConfigResult } from '@/lib/admin.types';
import { getConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import { configPatchSchema } from '@/lib/server/admin-config-policy';
import { checkMutationVersion, withConfigMutation } from '@/lib/server/config-mutation';
import { getAuthenticatedUser } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
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
    const config = await getConfig(true);
    checkMutationVersion(config.ConfigVersion || 0);
    const result: AdminConfigResult = {
      Role: 'owner',
      Config: config,
    };
    if (username === process.env.USERNAME) {
      result.Role = 'owner';
    } else {
      // 从新版数据库获取用户信息
      const { db } = await import('@/lib/db');
      const userInfoV2 = await db.getUserInfoV2(username);

      if (userInfoV2 && userInfoV2.role === 'admin' && !userInfoV2.banned) {
        result.Role = 'admin';
      } else {
        return NextResponse.json(
          { error: '你是管理员吗你就访问？' },
          { status: 401 }
        );
      }
    }

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store', // 管理员配置不缓存
      },
    });
  } catch (error) {
    logger.error('获取管理员配置失败:', error);
    return NextResponse.json(
      {
        error: '获取管理员配置失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}

export const POST = withConfigMutation(async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      { error: '不支持本地存储进行管理员配置' },
      { status: 400 }
    );
  }

  const authInfo = await getAuthenticatedUser(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const username = authInfo.username;

  try {
    const newConfig = await request.json();

    // 权限检查
    if (username !== process.env.USERNAME) {
      const { db } = await import('@/lib/db');
      const userInfoV2 = await db.getUserInfoV2(username);

      if (!userInfoV2 || userInfoV2.role !== 'admin' || userInfoV2.banned) {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
    }

    // 保存配置
    const { db } = await import('@/lib/db');
    const { configSelfCheck, setCachedConfig } = await import('@/lib/config');

    // 自检配置
    const parsed = configPatchSchema.safeParse(newConfig);
    if (!parsed.success) return NextResponse.json({ error: '仅允许更新指定字段；敏感配置请使用专用接口。', details: parsed.error.flatten() }, { status: 400 });
    const current = await getConfig(true);
    checkMutationVersion(current.ConfigVersion || 0);
    const checkedConfig = configSelfCheck({ ...current, ...parsed.data,
      SiteConfig: { ...current.SiteConfig, ...parsed.data.SiteConfig },
      OPDSConfig: parsed.data.OPDSConfig ? { ...current.OPDSConfig, ...parsed.data.OPDSConfig } : current.OPDSConfig,
    });

    // 保存到数据库
    await db.saveAdminConfig(checkedConfig);

    // 更新缓存
    await setCachedConfig(checkedConfig);

    return NextResponse.json({ success: true, message: '配置已保存' });
  } catch (error) {
    logger.error('保存配置失败:', error);
    return NextResponse.json(
      { error: '保存配置失败: ' + (error as Error).message },
      { status: 500 }
    );
  }
});
