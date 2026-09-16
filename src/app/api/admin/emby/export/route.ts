import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { getAuthenticatedUser } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      { error: '不支持本地存储进行管理员配置' },
      { status: 400 }
    );
  }

  try {
    const authInfo = await getAuthenticatedUser(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 仅站长可用
    if (authInfo.username !== process.env.USERNAME) {
      return NextResponse.json({ error: '权限不足，仅站长可用' }, { status: 403 });
    }

    const adminConfig = await getConfig();
    const embyConfig = adminConfig.EmbyConfig || {};

    const exportData = JSON.stringify(embyConfig, null, 2);

    return new NextResponse(exportData, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="emby-config-${Date.now()}.json"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: '导出失败: ' + (error as Error).message },
      { status: 500 }
    );
  }
}
