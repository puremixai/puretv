/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { logger } from '@/lib/logger';

import { getThemeCSS } from '@/styles/themes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // 禁用缓存

export async function GET(request: NextRequest) {
  try {
    const adminConfig = await getConfig();
    const themeConfig = adminConfig.ThemeConfig;

    // 如果没有配置主题，返回空CSS
    if (!themeConfig) {
      return new NextResponse('', {
        headers: {
          'Content-Type': 'text/css',
          'Cache-Control': 'no-store',
        },
      });
    }

    let css = '';

    // 如果启用了内置主题，使用内置主题CSS
    if (themeConfig.enableBuiltInTheme) {
      css = getThemeCSS(themeConfig.builtInTheme as any);
    } else {
      // 否则使用自定义CSS
      css = themeConfig.customCSS || '';
    }

    // 设置缓存控制
    const cacheMinutes = themeConfig.cacheMinutes || 1440; // 默认1天（1440分钟）
    const maxAge = cacheMinutes * 60; // 转换为秒
    const staleWhileRevalidate = maxAge * 7; // 过期后7倍时间内可使用旧版本
    const cacheControl = themeConfig.enableCache
      ? `public, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`
      : 'no-store';

    // 添加版本号到ETag
    const etag = `"${themeConfig.cacheVersion}"`;

    // 检查客户端缓存
    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch === etag && themeConfig.enableCache) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          'Cache-Control': cacheControl,
          ETag: etag,
        },
      });
    }

    return new NextResponse(css, {
      headers: {
        'Content-Type': 'text/css; charset=utf-8',
        'Cache-Control': cacheControl,
        ETag: etag,
      },
    });
  } catch (error) {
    logger.error('获取主题CSS失败:', error);
    return new NextResponse('', {
      headers: {
        'Content-Type': 'text/css',
        'Cache-Control': 'no-store',
      },
    });
  }
}
