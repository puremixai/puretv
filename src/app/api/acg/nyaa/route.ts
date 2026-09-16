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
  if (typeof first === 'object') return String(first._ ?? first.$?.url ?? first.$?.href ?? '');
  return String(first);
};

/**
 * POST /api/acg/nyaa
 * 搜索 Nyaa RSS（仅管理员和站长可用，不支持分页）
 * - https://nyaa.si/?page=rss&q=xxx&c=1_0&f=0
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
    const searchBaseUrl = getMagnetBaseUrl(
      'https://nyaa.si',
      config.SiteConfig.MagnetNyaaReverseProxy
    );
    const params = new URLSearchParams({
      page: 'rss',
      q: trimmedKeyword,
      c: '1_0',
      f: '0',
    });
    const searchUrl = `${searchBaseUrl}/?${params.toString()}`;

    const response = await universalMagnetFetch(searchUrl, config.SiteConfig.MagnetProxy, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`Nyaa API 请求失败: ${response.status}`);
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

    const results = items.map((item: any) => {
      const title = pickText(item.title);
      // Nyaa RSS 的 link 是 .torrent 下载地址，guid 才是详情页（且 guid 带 isPermaLink 属性）
      const torrentUrl = pickText(item.link);
      const detailUrl = pickText(item.guid) || torrentUrl;
      const guid = detailUrl || torrentUrl || `${title}-${pickText(item.pubDate)}`;
      const pubDate = pickText(item.pubDate);
      const size = pickText(item['nyaa:size']);
      const category = pickText(item['nyaa:category']);
      const seeders = pickText(item['nyaa:seeders']);
      const leechers = pickText(item['nyaa:leechers']);
      const downloads = pickText(item['nyaa:downloads']);
      const infoHash = pickText(item['nyaa:infoHash']);
      const description =
        pickText(item.description) ||
        [
          size && `大小：${size}`,
          category && `分类：${category}`,
          seeders && `Seeders：${seeders}`,
          leechers && `Leechers：${leechers}`,
          downloads && `下载：${downloads}`,
          infoHash && `Hash：${infoHash}`,
        ].filter(Boolean).join(' | ');

      let images: string[] = [];
      if (description) {
        const imgMatches = description.match(/src="([^"]+)"/g);
        if (imgMatches) {
          images = imgMatches.map((match: string) => {
            const urlMatch = match.match(/src="([^"]+)"/);
            return urlMatch ? urlMatch[1] : '';
          }).filter(Boolean);
        }
      }

      return {
        title,
        link: detailUrl,
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
    logger.error('Nyaa 搜索失败:', error);
    return NextResponse.json(
      { error: error.message || '搜索失败' },
      { status: 500 }
    );
  }
}
