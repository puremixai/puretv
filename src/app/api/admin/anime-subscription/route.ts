/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { validateKeywordExpr } from '@/lib/anime-keyword-expr';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { checkMutationVersion, withConfigMutation } from '@/lib/server/config-mutation';
import { getAuthenticatedUser } from '@/lib/session';

import { AnimeSubscription } from '@/types/anime-subscription';

export const runtime = 'nodejs';

/**
 * GET /api/admin/anime-subscription
 * 获取订阅列表和配置
 */
export async function GET(req: NextRequest) {
  try {
    // 权限检查
    const authInfo = await getAuthenticatedUser(req);
    if (!authInfo || (authInfo.role !== 'admin' && authInfo.role !== 'owner')) {
      return NextResponse.json({ error: '无权限访问' }, { status: 403 });
    }

    const config = await getConfig(true);
    checkMutationVersion(config.ConfigVersion || 0);
    const animeConfig = config.AnimeSubscriptionConfig || {
      Enabled: false,
      DownloadTool: 'aria2',
      Subscriptions: [],
    };

    return NextResponse.json({
      ...animeConfig,
      DownloadTool: animeConfig.DownloadTool || 'aria2',
    });
  } catch (error: any) {
    logger.error('获取追番订阅配置失败:', error);
    return NextResponse.json(
      { error: error.message || '获取配置失败' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/anime-subscription
 * 创建新订阅
 */
export const POST = withConfigMutation(async function POST(req: NextRequest) {
  try {
    // 权限检查
    const authInfo = await getAuthenticatedUser(req);
    if (!authInfo || (authInfo.role !== 'admin' && authInfo.role !== 'owner')) {
      return NextResponse.json({ error: '无权限访问' }, { status: 403 });
    }

    const {
      title,
      filterText,
      excludeText,
      source,
      enabled,
      lastEpisode,
      onePerEpisode,
      refillMissingEpisodes,
    } = await req.json();

    // 验证必填字段
    if (!title || !filterText || !source) {
      return NextResponse.json({ error: '缺少必填字段' }, { status: 400 });
    }

    // 验证 source
    if (!['acgrip', 'mikan', 'dmhy', 'nyaa'].includes(source)) {
      return NextResponse.json({ error: '无效的搜索源' }, { status: 400 });
    }

    const filterCheck = validateKeywordExpr(String(filterText), 'and');
    if (!filterCheck.ok) {
      return NextResponse.json(
        { error: `过滤关键词表达式无效: ${filterCheck.error}` },
        { status: 400 }
      );
    }
    if (typeof excludeText === 'string' && excludeText.trim()) {
      const excludeCheck = validateKeywordExpr(excludeText, 'or');
      if (!excludeCheck.ok) {
        return NextResponse.json(
          { error: `排除关键词表达式无效: ${excludeCheck.error}` },
          { status: 400 }
        );
      }
    }

    const config = await getConfig(true);
    checkMutationVersion(config.ConfigVersion || 0);
    if (!config.AnimeSubscriptionConfig) {
      config.AnimeSubscriptionConfig = {
        Enabled: false,
        DownloadTool: 'aria2',
        Subscriptions: [],
      };
    } else if (!config.AnimeSubscriptionConfig.DownloadTool) {
      config.AnimeSubscriptionConfig.DownloadTool = 'aria2';
    }

    // 验证集数
    let episodeNum = 0;
    if (lastEpisode !== undefined) {
      episodeNum = parseInt(String(lastEpisode), 10);
      if (isNaN(episodeNum) || episodeNum < 0) {
        return NextResponse.json(
          { error: '集数必须是非负整数' },
          { status: 400 }
        );
      }
    }

    const normalizedTitle = String(title).trim().replace(/\s+/g, ' ');
    if (!normalizedTitle) {
      return NextResponse.json({ error: '番剧名称不能为空' }, { status: 400 });
    }

    // 拒绝重复番剧名（忽略大小写与首尾空白）
    const exists = (config.AnimeSubscriptionConfig.Subscriptions || []).some(
      (sub) =>
        sub.title.trim().replace(/\s+/g, ' ').toLowerCase() ===
        normalizedTitle.toLowerCase()
    );
    if (exists) {
      return NextResponse.json(
        { error: `已存在同名追番订阅「${normalizedTitle}」，请勿重复添加` },
        { status: 409 }
      );
    }

    // 创建新订阅
    const newSubscription: AnimeSubscription = {
      id: crypto.randomUUID(),
      title: normalizedTitle,
      filterText: filterText.trim(),
      excludeText: typeof excludeText === 'string' ? excludeText.trim() : '',
      source,
      enabled: enabled ?? true,
      onePerEpisode: Boolean(onePerEpisode),
      refillMissingEpisodes: Boolean(refillMissingEpisodes),
      lastCheckTime: 0,
      lastEpisode: episodeNum,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: authInfo.username || 'unknown',
    };

    config.AnimeSubscriptionConfig.Subscriptions.push(newSubscription);
    await db.saveAdminConfig(config);

    return NextResponse.json(newSubscription);
  } catch (error: any) {
    logger.error('创建追番订阅失败:', error);
    return NextResponse.json(
      { error: error.message || '创建订阅失败' },
      { status: 500 }
    );
  }
});
