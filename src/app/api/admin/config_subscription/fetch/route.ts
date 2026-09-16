

import { NextRequest, NextResponse } from 'next/server';

import {
  mergeSubscriptionConfigs,
  validateSubscriptions,
} from '@/lib/config-subscriptions';
import { logger } from '@/lib/logger';
import {
  fetchSubscriptionContent,
  refreshSubscriptions,
} from '@/lib/server/config-subscriptions';
import { getAuthenticatedUser } from '@/lib/session';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    // 权限检查：仅站长可以拉取配置订阅
    const authInfo = await getAuthenticatedUser(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (authInfo.username !== process.env.USERNAME) {
      return NextResponse.json(
        { error: '权限不足，只有站长可以拉取配置订阅' },
        { status: 401 }
      );
    }

    const { url, subscriptions, configFile = '{}', id } = await request.json();

    if (subscriptions !== undefined) {
      const list = validateSubscriptions(subscriptions);
      if (
        id !== undefined &&
        (typeof id !== 'string' ||
          !list.some((sub) => sub.ID === id && sub.Enabled))
      ) {
        return NextResponse.json(
          { error: '订阅不存在或已停用' },
          { status: 400 }
        );
      }
      // Validate the local file before issuing any network requests.
      mergeSubscriptionConfigs(configFile, list);
      const updated = await refreshSubscriptions(list, { id });
      const merged = mergeSubscriptionConfigs(configFile, updated);
      return NextResponse.json({
        success: true,
        subscriptions: updated,
        configContent: JSON.stringify(merged, null, 2),
        sourceCount: Object.keys(merged.api_site || {}).length,
        failedCount: updated.filter(
          (sub) => sub.Enabled && (!id || sub.ID === id) && sub.LastError
        ).length,
      });
    }

    if (!url) {
      return NextResponse.json({ error: '缺少URL参数' }, { status: 400 });
    }

    const decodedContent = await fetchSubscriptionContent(url);

    return NextResponse.json({
      success: true,
      configContent: decodedContent,
      message: '配置拉取成功',
    });
  } catch (error) {
    logger.error('拉取配置失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '拉取配置失败' },
      { status: 400 }
    );
  }
}
