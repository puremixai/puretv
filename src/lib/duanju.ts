
import { API_CONFIG, getAvailableApiSites } from '@/lib/config';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

interface CmsClassResponse {
  class?: Array<{
    type_id: string | number;
    type_name: string;
  }>;
}

export interface DuanjuSource {
  key: string;
  name: string;
  api: string;
  typeId?: string;
  typeName?: string;
}

export function isDuanjuTypeName(typeName: string): boolean {
  const normalizedTypeName = typeName.toLowerCase();
  return (
    normalizedTypeName.includes('短剧') ||
    normalizedTypeName.includes('短视频') ||
    normalizedTypeName.includes('微短剧')
  );
}

/**
 * 获取包含短剧分类的视频源列表
 */
export async function getDuanjuSources(): Promise<DuanjuSource[]> {
  try {
    // 先查询数据库中是否有缓存
    const cachedData = await db.getGlobalValue('duanju');

    if (cachedData !== null) {
      // 有缓存，直接返回（getGlobalValue 已经处理了序列化问题）
      const cachedSources: DuanjuSource[] = cachedData ? JSON.parse(cachedData) : [];
      // 旧版本缓存只保存采集源，不包含短剧分类 ID。缺少 typeId 时自动重建缓存。
      if (
        cachedSources.length === 0 ||
        cachedSources.every((source) => source.typeId)
      ) {
        return cachedSources;
      }

      logger.debug('短剧视频源缓存缺少分类信息，重新筛选...');
    }

    // 没有缓存，开始筛选
    logger.debug('开始筛选包含短剧分类的视频源...');
    const allSources = await getAvailableApiSites();
    const duanjuSources: DuanjuSource[] = [];

    // 并发���求所有视频源的分类列表
    const checkPromises = allSources.map(async (source) => {
      try {
        const classUrl = `${source.api}?ac=list`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(classUrl, {
          headers: API_CONFIG.search.headers,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          return null;
        }

        const data: CmsClassResponse = await response.json();

        // 检查是否有短剧分类
        if (data.class && Array.isArray(data.class)) {
          const duanjuType = data.class.find((item) =>
            isDuanjuTypeName(item.type_name || '')
          );

          if (duanjuType) {
            return {
              key: source.key,
              name: source.name,
              api: source.api,
              typeId: duanjuType.type_id.toString(),
              typeName: duanjuType.type_name,
            };
          }
        }

        return null;
      } catch (error) {
        // 请求失败或超时，忽略该源
        logger.error(`检查视频源 ${source.name} 失败:`, error);
        return null;
      }
    });

    const results = await Promise.all(checkPromises);

    // 过滤掉null值
    results.forEach((result) => {
      if (result) {
        duanjuSources.push(result);
      }
    });

    logger.debug(`找到 ${duanjuSources.length} 个包含短剧分类的视频源`);

    // 存入数据库（即使是空数组也要存）
    await db.setGlobalValue('duanju', JSON.stringify(duanjuSources));

    return duanjuSources;
  } catch (error) {
    logger.error('获取短剧视频源失败:', error);
    throw error;
  }
}
