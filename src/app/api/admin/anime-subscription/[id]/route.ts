/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { validateKeywordExpr } from '@/lib/anime-keyword-expr';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { checkMutationVersion, withConfigMutation } from '@/lib/server/config-mutation';
import { getAuthenticatedUser } from '@/lib/session';

export const runtime = 'nodejs';

/**
 * PUT /api/admin/anime-subscription/[id]
 * 更新订阅
 */
export const PUT = withConfigMutation(async function PUT(
  req: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const params = await paramsPromise;
  try {
    // 权限检查
    const authInfo = await getAuthenticatedUser(req);
    if (!authInfo || (authInfo.role !== 'admin' && authInfo.role !== 'owner')) {
      return NextResponse.json({ error: '无权限访问' }, { status: 403 });
    }

    const config = await getConfig(true);
    checkMutationVersion(config.ConfigVersion || 0);
    const subscriptions = config.AnimeSubscriptionConfig?.Subscriptions || [];

    const index = subscriptions.findIndex((sub) => sub.id === params.id);
    if (index === -1) {
      return NextResponse.json({ error: '订阅不存在' }, { status: 404 });
    }

    const updates = await req.json();
    const subscription = subscriptions[index];

    // 更新字段
    if (updates.title !== undefined) {
      const normalizedTitle = String(updates.title).trim().replace(/\s+/g, ' ');
      if (!normalizedTitle) {
        return NextResponse.json({ error: '番剧名称不能为空' }, { status: 400 });
      }
      const duplicated = subscriptions.some(
        (sub) =>
          sub.id !== params.id &&
          sub.title.trim().replace(/\s+/g, ' ').toLowerCase() ===
            normalizedTitle.toLowerCase()
      );
      if (duplicated) {
        return NextResponse.json(
          { error: `已存在同名追番订阅「${normalizedTitle}」，请勿重复添加` },
          { status: 409 }
        );
      }
      subscription.title = normalizedTitle;
    }
    if (updates.filterText !== undefined) {
      const filterCheck = validateKeywordExpr(String(updates.filterText), 'and');
      if (!filterCheck.ok) {
        return NextResponse.json(
          { error: `过滤关键词表达式无效: ${filterCheck.error}` },
          { status: 400 }
        );
      }
      subscription.filterText = updates.filterText.trim();
    }
    if (updates.excludeText !== undefined) {
      const rawExclude =
        typeof updates.excludeText === 'string' ? updates.excludeText.trim() : '';
      if (rawExclude) {
        const excludeCheck = validateKeywordExpr(rawExclude, 'or');
        if (!excludeCheck.ok) {
          return NextResponse.json(
            { error: `排除关键词表达式无效: ${excludeCheck.error}` },
            { status: 400 }
          );
        }
      }
      subscription.excludeText = rawExclude;
    }
    if (updates.source !== undefined) {
      if (!['acgrip', 'mikan', 'dmhy', 'nyaa'].includes(updates.source)) {
        return NextResponse.json({ error: '无效的搜索源' }, { status: 400 });
      }
      subscription.source = updates.source;
    }
    if (updates.enabled !== undefined) {
      subscription.enabled = updates.enabled;
    }
    if (updates.onePerEpisode !== undefined) {
      subscription.onePerEpisode = Boolean(updates.onePerEpisode);
    }
    if (updates.refillMissingEpisodes !== undefined) {
      subscription.refillMissingEpisodes = Boolean(
        updates.refillMissingEpisodes
      );
    }
    if (updates.lastEpisode !== undefined) {
      // 验证集数为非负整数
      const episode = parseInt(String(updates.lastEpisode), 10);
      if (isNaN(episode) || episode < 0) {
        return NextResponse.json(
          { error: '集数必须是非负整数' },
          { status: 400 }
        );
      }
      subscription.lastEpisode = episode;
    }

    subscription.updatedAt = Date.now();

    await db.saveAdminConfig(config);

    return NextResponse.json(subscription);
  } catch (error: any) {
    logger.error('更新追番订阅失败:', error);
    return NextResponse.json(
      { error: error.message || '更新订阅失败' },
      { status: 500 }
    );
  }
});

/**
 * DELETE /api/admin/anime-subscription/[id]
 * 删除订阅
 */
export const DELETE = withConfigMutation(async function DELETE(
  req: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const params = await paramsPromise;
  try {
    // 权限检查
    const authInfo = await getAuthenticatedUser(req);
    if (!authInfo || (authInfo.role !== 'admin' && authInfo.role !== 'owner')) {
      return NextResponse.json({ error: '无权限访问' }, { status: 403 });
    }

    const config = await getConfig(true);
    checkMutationVersion(config.ConfigVersion || 0);
    const subscriptions = config.AnimeSubscriptionConfig?.Subscriptions || [];

    const index = subscriptions.findIndex((sub) => sub.id === params.id);
    if (index === -1) {
      return NextResponse.json({ error: '订阅不存在' }, { status: 404 });
    }

    subscriptions.splice(index, 1);
    await db.saveAdminConfig(config);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    logger.error('删除追番订阅失败:', error);
    return NextResponse.json(
      { error: error.message || '删除订阅失败' },
      { status: 500 }
    );
  }
});
