/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { parseStringPromise } from 'xml2js';

import { getConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import { getMagnetBaseUrl, universalMagnetFetch } from '@/lib/magnet.client';
import { hasFeaturePermission } from '@/lib/permissions';
import { getAuthenticatedUser } from '@/lib/session';

export const runtime = 'nodejs';

const pickText = (value: any): string => {
  if (value === undefined || value === null) return '';
  const first = Array.isArray(value) ? value[0] : value;
  if (first === undefined || first === null) return '';
  if (typeof first === 'object') {
    return String(first._ ?? first.$?.url ?? first.$?.href ?? '').trim();
  }
  return String(first).trim();
};

/**
 * POST /api/acg/dmhy
 * 搜索 动漫花园 (share.dmhy.org) RSS（仅管理员和站长可用）
 * - http://share.dmhy.org/topics/rss/rss.xml?keyword=xxx
 * - RSS 不支持分页（page>1 返回空 items）
 */
export async function POST(req: NextRequest) {
  try {
    const authInfo = await getAuthenticatedUser(req);
    if (!authInfo?.username || !(await hasFeaturePermission(authInfo.username, 'magnet_search'))) {
      return NextResponse.json(
        { error: '无权限访问' },
        { status: 403 }
      );
    }

    const { keyword, page = 1 } = await req.json();

    if (!keyword || typeof keyword !== 'string') {
      return NextResponse.json(
        { error: '搜索关键词不能为空' },
        { status: 400 }
      );
    }

    const trimmedKeyword = keyword.trim();
    if (!trimmedKeyword) {
      return NextResponse.json(
        { error: '搜索关键词不能为空' },
        { status: 400 }
      );
    }

    const pageNum = parseInt(String(page), 10);
    if (isNaN(pageNum) || pageNum < 1) {
      return NextResponse.json(
        { error: '页码必须是大于0的整数' },
        { status: 400 }
      );
    }

    if (pageNum > 1) {
      return NextResponse.json({
        keyword: trimmedKeyword,
        page: pageNum,
        total: 0,
        items: [],
      });
    }

    const config = await getConfig();
    const baseUrl = `${getMagnetBaseUrl(
      'http://share.dmhy.org',
      config.SiteConfig.MagnetDmhyReverseProxy
    )}/topics/rss/rss.xml`;
    const params = new URLSearchParams({ keyword: trimmedKeyword });
    const searchUrl = `${baseUrl}?${params.toString()}`;

    const response = await universalMagnetFetch(searchUrl, config.SiteConfig.MagnetProxy, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`DMHY API 请求失败: ${response.status}`);
    }

    const xmlData = await response.text();
    const parsed = await parseStringPromise(xmlData);

    if (!parsed?.rss?.channel?.[0]?.item) {
      return NextResponse.json({
        keyword: trimmedKeyword,
        page: pageNum,
        total: 0,
        items: [],
      });
    }

    const items = parsed.rss.channel[0].item;

    const results = items.map((item: any, index: number) => {
      const title = pickText(item.title);
      const link = pickText(item.link);
      const pubDate = pickText(item.pubDate);
      const description = pickText(item.description);
      const torrentUrl =
        pickText(item.enclosure?.[0]?.$?.url) ||
        pickText(item.enclosure?.[0]?.$?.href) ||
        pickText(item.enclosure?.[0]);
      // guid 在 xml2js 下常为 { _: url, $: { isPermaLink } }，必须抽成纯字符串，否则前端 key 全变成 [object Object]
      const guid =
        pickText(item.guid) ||
        torrentUrl ||
        link ||
        `${title}-${pubDate}-${index}`;

      // 提取描述中的图片（如果有）
      let images: string[] = [];
      if (description) {
        const imgMatches = description.match(/src="([^"]+)"/g);
        if (imgMatches) {
          images = imgMatches
            .map((match: string) => {
              const urlMatch = match.match(/src="([^"]+)"/);
              return urlMatch ? urlMatch[1] : '';
            })
            .filter(Boolean);
        }
      }

      return {
        title,
        link,
        guid,
        pubDate,
        torrentUrl,
        description,
        images,
      };
    });

    return NextResponse.json({
      keyword: trimmedKeyword,
      page: pageNum,
      total: results.length,
      items: results,
    });
  } catch (error: any) {
    logger.error('DMHY 搜索失败:', error);
    return NextResponse.json(
      { error: error.message || '搜索失败' },
      { status: 500 }
    );
  }
}
