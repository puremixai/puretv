/* 繁简转换 —— 独立客户端模块。
 *
 * 服务端 bundle 不应包含 opencc-js（其字典约 1.9MB，会撑爆 Cloudflare Worker）。
 * opencc-js 只在客户端加载（本文件 + search 页面复用），服务端打包 danmaku/api.ts
 * 或 search 路由时不应把本文件的 opencc-js 动态 import 内联进 worker。
 */

type OpenCCConverter = (text: string) => string;

// Load only the traditional-to-simplified dictionary when conversion is requested.

import { logger } from '@/lib/logger';

let danmakuConverter: OpenCCConverter | null = null;
let danmakuConverterPromise: Promise<OpenCCConverter | null> | null = null;

/**
 * 加载繁简转换器（from: hk → to: cn）。同一进程只加载一次。
 * 仅客户端可调用；服务端（SSR）下 window 未定义时由调用方自行保护。
 */
export function loadTraditionalToSimplifiedConverter(): Promise<OpenCCConverter | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (danmakuConverter) return Promise.resolve(danmakuConverter);
  if (!danmakuConverterPromise) {
    danmakuConverterPromise = import('opencc-js/t2cn')
      .then(({ Converter }) => {
        danmakuConverter = Converter({ from: 'hk', to: 'cn' });
        return danmakuConverter;
      })
      .catch((error) => {
        logger.error('初始化繁简转换器失败:', error);
        danmakuConverter = null;
        danmakuConverterPromise = null;
        return null;
      });
  }
  return danmakuConverterPromise;
}

export async function prepareDanmakuTextConversion(): Promise<void> {
  if (
    typeof window !== 'undefined' &&
    localStorage.getItem('danmakuTraditionalToSimplified') === 'true'
  )
    await loadTraditionalToSimplifiedConverter();
}

export function convertDanmakuText(text: string): string {
  if (
    typeof window === 'undefined' ||
    localStorage.getItem('danmakuTraditionalToSimplified') !== 'true'
  ) {
    return text;
  }

  // 转换器尚未就绪时原样返回（预热后通常已加载完成）
  if (!danmakuConverter) return text;

  try {
    return danmakuConverter(text);
  } catch (error) {
    logger.error('弹幕繁简转换失败:', error);
    return text;
  }
}
