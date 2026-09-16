/* eslint-disable @typescript-eslint/no-explicit-any */

import parseTorrentName from 'parse-torrent-name';

import type { AdminConfig } from '@/lib/admin.types';
import { getConfig } from '@/lib/config';
import { generateFolderKey } from '@/lib/crypto';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { OpenListClient } from '@/lib/openlist.client';
import {
  invalidateMetaInfoCache,
  MetaInfo,
  setCachedMetaInfo,
} from '@/lib/openlist-cache';
import {
  cleanupOldTasks,
  completeScanTask,
  createScanTask,
  failScanTask,
  getScanTask,
  updateScanTaskProgress,
} from '@/lib/scan-task';
import { parseSeasonFromTitle } from '@/lib/season-parser';
import { type GoJobLease, acquireGoJob } from '@/lib/server/go-jobs';
import { isGoWorkerEnabled, scanGoOpenListRoots } from '@/lib/server/go-worker';
import { getTVSeasonDetails, searchTMDB } from '@/lib/tmdb.search';

/**
 * 获取根目录列表（兼容新旧配置）
 */
/**
 * 清理字符串中的 BOM 和其他不可见字符
 */
function cleanPath(path: string): string {
  // 移除 UTF-8 BOM (U+FEFF) 和其他零宽度字符
  return path
    .replace(/^\uFEFF/, '') // 移除开头的 BOM
    .replace(/\uFEFF/g, '') // 移除所有 BOM
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // 移除零宽度字符
    .trim(); // 移除首尾空白
}

function getRootPaths(openListConfig: AdminConfig['OpenListConfig']): string[] {
  if (!openListConfig) {
    return ['/'];
  }

  // 如果有新字段 RootPaths，直接使用并清理
  if (openListConfig.RootPaths && openListConfig.RootPaths.length > 0) {
    return openListConfig.RootPaths.map(cleanPath);
  }

  // 如果只有 RootPath，返回单元素数组并清理
  if (openListConfig.RootPath) {
    return [cleanPath(openListConfig.RootPath)];
  }

  // 默认值
  return ['/'];
}

/**
 * 迁移旧版单根目录配置到多根目录
 */
async function migrateToMultiRoot(
  openListConfig: NonNullable<AdminConfig['OpenListConfig']>,
  lease?: GoJobLease,
): Promise<void> {
  const oldRootPath = openListConfig.RootPath!;

  logger.debug('[OpenList Migration] 检测到旧版配置，开始迁移...');

  // 1. 读取现有 metainfo
  const metainfoContent = await db.getGlobalValue('video.metainfo');
  if (metainfoContent) {
    const metaInfo: MetaInfo = JSON.parse(metainfoContent);

    // 2. 迁移 folderName：加上原根路径前缀
    for (const [_key, info] of Object.entries(metaInfo.folders)) {
      const oldFolderName = info.folderName;
      const newFolderName = `${oldRootPath}${oldRootPath.endsWith('/') ? '' : '/'}${oldFolderName}`;
      info.folderName = newFolderName;

      logger.debug(`[Migration] ${oldFolderName} -> ${newFolderName}`);
    }

    // 3. 保存迁移后的 metainfo
    lease?.assertActive();
    await db.setGlobalValue('video.metainfo', JSON.stringify(metaInfo));
    logger.debug('[OpenList Migration] MetaInfo 迁移完成');
  }

  // 4. 更新配置：RootPath -> RootPaths
  const config = await getConfig();
  config.OpenListConfig!.RootPaths = [oldRootPath];
  delete config.OpenListConfig!.RootPath;
  lease?.assertActive();
  await db.saveAdminConfig(config);

  logger.debug('[OpenList Migration] 配置迁移完成');
}

/**
 * 启动 OpenList 刷新任务
 */
export async function startOpenListRefresh(
  clearMetaInfo = false,
): Promise<{ taskId: string }> {
  const config = await getConfig();
  const openListConfig = config.OpenListConfig;

  if (
    !openListConfig ||
    !openListConfig.Enabled ||
    !openListConfig.URL ||
    !openListConfig.Username ||
    !openListConfig.Password
  ) {
    throw new Error('OpenList 未配置或未启用');
  }

  const tmdbApiKey = config.SiteConfig.TMDBApiKey;
  const tmdbProxy = config.SiteConfig.TMDBProxy;
  const tmdbReverseProxy = config.SiteConfig.TMDBReverseProxy;

  if (!tmdbApiKey) {
    throw new Error('TMDB API Key 未配置');
  }

  const signature = JSON.stringify([
    openListConfig,
    tmdbApiKey,
    tmdbProxy,
    tmdbReverseProxy,
  ]);
  const lease = await acquireGoJob('openlist-refresh');

  try {
    if (lease) {
      const latest = await getConfig(true);
      lease.assertActive();
      if (
        JSON.stringify([
          latest.OpenListConfig,
          latest.SiteConfig.TMDBApiKey,
          latest.SiteConfig.TMDBProxy,
          latest.SiteConfig.TMDBReverseProxy,
        ]) !== signature
      ) {
        throw new Error('扫描配置已变更，请重新发起刷新');
      }
    }
    // 检测是否需要迁移
    if (openListConfig.RootPath && !openListConfig.RootPaths) {
      await migrateToMultiRoot(openListConfig, lease);
      // 重新加载配置
      const newConfig = await getConfig();
      Object.assign(openListConfig, newConfig.OpenListConfig);
    }

    cleanupOldTasks();
    const taskId = createScanTask(lease?.id);
    await lease?.renew(getScanTask(taskId));

    const rootPaths = getRootPaths(openListConfig);

    // 顺序扫描多个根目录
    performMultiRootScan(
      taskId,
      openListConfig.URL,
      rootPaths,
      tmdbApiKey,
      tmdbProxy,
      tmdbReverseProxy,
      openListConfig.Username,
      openListConfig.Password,
      clearMetaInfo,
      openListConfig.ScanMode || 'hybrid',
      lease,
    ).catch((error) => {
      logger.error('[OpenList Refresh] 后台扫描失败:', error);
      failScanTask(taskId, (error as Error).message);
    });

    return { taskId };
  } catch (error) {
    await lease?.finish(false).catch(() => undefined);
    throw error;
  }
}

async function loadMetaInfo(clearMetaInfo: boolean): Promise<MetaInfo> {
  if (clearMetaInfo) {
    return {
      folders: {},
      last_refresh: Date.now(),
    };
  }

  try {
    const metainfoContent = await db.getGlobalValue('video.metainfo');
    if (metainfoContent) {
      return JSON.parse(metainfoContent);
    }
  } catch (error) {
    logger.error('[OpenList Refresh] 读取现有 metainfo 失败:', error);
  }

  return {
    folders: {},
    last_refresh: Date.now(),
  };
}

async function listRootFolders(
  client: OpenListClient,
  rootPath: string,
): Promise<any[]> {
  const folders: any[] = [];
  let currentPage = 1;
  const pageSize = 100;

  for (;;) {
    const listResponse = await client.listDirectory(
      rootPath,
      currentPage,
      pageSize,
      true,
    );
    if (listResponse.code !== 200) {
      throw new Error(`OpenList 列表获取失败: ${rootPath}`);
    }

    const content = listResponse.data.content || [];
    folders.push(...content.filter((item) => item.is_dir));

    if (content.length < pageSize) {
      break;
    }

    currentPage++;
  }

  return folders;
}

/**
 * 扫描多个根目录：先汇总全部文件夹数量，再连续累计进度，最后统一完成任务
 */
async function performMultiRootScan(
  taskId: string,
  url: string,
  rootPaths: string[],
  tmdbApiKey: string,
  tmdbProxy: string | undefined,
  tmdbReverseProxy: string | undefined,
  username: string,
  password: string,
  clearMetaInfo: boolean,
  scanMode: 'torrent' | 'name' | 'hybrid',
  lease?: GoJobLease,
): Promise<void> {
  updateScanTaskProgress(taskId, 0, 0);

  try {
    const metaInfo = await loadMetaInfo(clearMetaInfo);
    invalidateMetaInfoCache();

    const rootFolderGroups: { rootPath: string; folders: any[] }[] = [];
    let totalFolders = 0;

    if (isGoWorkerEnabled('openlistScan')) {
      const result = await scanGoOpenListRoots({
        url,
        username,
        password,
        rootPaths,
      });
      rootFolderGroups.push(...result.groups);
      totalFolders = result.groups.reduce(
        (total, group) => total + group.folders.length,
        0,
      );
      for (const failure of result.errors) {
        logger.error(`[OpenList Refresh] 根目录 ${failure.rootPath} 列举失败`);
      }
    } else {
      const client = new OpenListClient(url, username, password);
      for (let i = 0; i < rootPaths.length; i++) {
        const rootPath = rootPaths[i];
        logger.debug(
          `[OpenList Refresh] 列举根目录 (${i + 1}/${rootPaths.length}): ${rootPath}`,
        );

        try {
          const folders = await listRootFolders(client, rootPath);
          rootFolderGroups.push({ rootPath, folders });
          totalFolders += folders.length;
          logger.debug(
            `[OpenList Refresh] 根目录 ${rootPath} 发现 ${folders.length} 个文件夹`,
          );
        } catch (error) {
          logger.error(
            `[OpenList Refresh] 根目录 ${rootPath} 列举失败:`,
            error,
          );
        }
      }
    }

    if (rootFolderGroups.length === 0) {
      throw new Error('所有根目录列举失败');
    }

    updateScanTaskProgress(taskId, 0, totalFolders);
    await lease?.renew(getScanTask(taskId));

    let processed = 0;
    let newCount = 0;
    let existingCount = 0;
    let errorCount = 0;

    const existingKeys = new Set<string>(Object.keys(metaInfo.folders));
    const folderNameToKey = new Map<string, string>();
    for (const [key, info] of Object.entries(metaInfo.folders)) {
      folderNameToKey.set(info.folderName, key);
    }

    for (const { rootPath, folders } of rootFolderGroups) {
      logger.debug(
        `[OpenList Refresh] 处理根目录: ${rootPath} (${folders.length} 个文件夹)`,
      );

      for (const folder of folders) {
        lease?.assertActive();
        processed++;
        updateScanTaskProgress(taskId, processed, totalFolders, folder.name);
        await lease?.renew(getScanTask(taskId));

        const fullFolderPath = `${rootPath}${rootPath.endsWith('/') ? '' : '/'}${folder.name}`;

        if (!clearMetaInfo && folderNameToKey.has(fullFolderPath)) {
          existingCount++;
          continue;
        }

        const folderKey = generateFolderKey(fullFolderPath, existingKeys);
        existingKeys.add(folderKey);

        try {
          let searchQuery: string;
          let seasonNumber: number | null = null;
          let year: number | null = null;
          let searchResult: any;

          if (scanMode === 'torrent' || scanMode === 'hybrid') {
            const torrentInfo = parseTorrentName(folder.name);
            searchQuery = torrentInfo.title || folder.name;
            seasonNumber = torrentInfo.season || null;
            year = torrentInfo.year || null;

            logger.debug(
              `[OpenList Refresh] 种子库模式 - 文件夹: ${folder.name}`,
            );
            logger.debug(
              `[OpenList Refresh] 解析结果 - 标题: ${searchQuery}, 季度: ${seasonNumber}, 年份: ${year}`,
            );

            searchResult = await searchTMDB(
              tmdbApiKey,
              searchQuery,
              tmdbProxy,
              year || undefined,
              tmdbReverseProxy,
            );
          }

          if (
            scanMode === 'name' ||
            (scanMode === 'hybrid' &&
              (!searchResult ||
                searchResult.code !== 200 ||
                !searchResult.result))
          ) {
            const seasonInfo = parseSeasonFromTitle(folder.name);
            searchQuery = seasonInfo.cleanTitle || folder.name;
            seasonNumber = seasonInfo.seasonNumber;
            year = seasonInfo.year;

            logger.debug(
              `[OpenList Refresh] 名字匹配模式 - 文件夹: ${folder.name}`,
            );
            logger.debug(
              `[OpenList Refresh] 清理后标题: ${searchQuery}, 季度: ${seasonNumber}, 年份: ${year}`,
            );

            searchResult = await searchTMDB(
              tmdbApiKey,
              searchQuery,
              tmdbProxy,
              year || undefined,
              tmdbReverseProxy,
            );
          }

          if (searchResult.code === 200 && searchResult.result) {
            const result = searchResult.result;

            const folderInfo: any = {
              folderName: fullFolderPath,
              tmdb_id: result.id,
              title: result.title || result.name || folder.name,
              poster_path: result.poster_path,
              release_date: result.release_date || result.first_air_date || '',
              overview: result.overview,
              vote_average: result.vote_average,
              media_type: result.media_type,
              last_updated: Date.now(),
              failed: false,
            };

            if (result.media_type === 'tv' && seasonNumber) {
              try {
                const seasonDetails = await getTVSeasonDetails(
                  tmdbApiKey,
                  result.id,
                  seasonNumber,
                  tmdbProxy,
                  tmdbReverseProxy,
                );

                if (seasonDetails.code === 200 && seasonDetails.season) {
                  folderInfo.season_number = seasonDetails.season.season_number;
                  folderInfo.season_name = seasonDetails.season.name;

                  if (seasonDetails.season.season_number > 1) {
                    folderInfo.title = `${folderInfo.title} ${seasonDetails.season.name}`;
                  }

                  if (seasonDetails.season.poster_path) {
                    folderInfo.poster_path = seasonDetails.season.poster_path;
                  }
                  if (seasonDetails.season.overview) {
                    folderInfo.overview = seasonDetails.season.overview;
                  }
                  if (seasonDetails.season.air_date) {
                    folderInfo.release_date = seasonDetails.season.air_date;
                  }
                } else {
                  logger.warn(
                    `[OpenList Refresh] 获取季度 ${seasonNumber} 详情失败`,
                  );
                  folderInfo.season_number = seasonNumber;
                }
              } catch (error) {
                logger.error(`[OpenList Refresh] 获取季度详情异常:`, error);
                folderInfo.season_number = seasonNumber;
              }
            }

            metaInfo.folders[folderKey] = folderInfo;
            folderNameToKey.set(fullFolderPath, folderKey);
            newCount++;
          } else {
            metaInfo.folders[folderKey] = {
              folderName: fullFolderPath,
              tmdb_id: 0,
              title: folder.name,
              poster_path: null,
              release_date: '',
              overview: '',
              vote_average: 0,
              media_type: 'movie',
              last_updated: Date.now(),
              failed: true,
            };
            folderNameToKey.set(fullFolderPath, folderKey);
            errorCount++;
          }

          await new Promise((resolve) => setTimeout(resolve, 300));
        } catch (error) {
          logger.error(
            `[OpenList Refresh] 处理文件夹失败: ${folder.name}`,
            error,
          );
          metaInfo.folders[folderKey] = {
            folderName: fullFolderPath,
            tmdb_id: 0,
            title: folder.name,
            poster_path: null,
            release_date: '',
            overview: '',
            vote_average: 0,
            media_type: 'movie',
            last_updated: Date.now(),
            failed: true,
          };
          folderNameToKey.set(fullFolderPath, folderKey);
          errorCount++;
        }
      }
    }

    metaInfo.last_refresh = Date.now();

    await lease?.renew(getScanTask(taskId));
    await db.setGlobalValue('video.metainfo', JSON.stringify(metaInfo));
    invalidateMetaInfoCache();
    setCachedMetaInfo(metaInfo);

    const config = await getConfig();
    config.OpenListConfig!.LastRefreshTime = Date.now();
    config.OpenListConfig!.ResourceCount = Object.keys(metaInfo.folders).length;
    lease?.assertActive();
    await db.saveAdminConfig(config);

    completeScanTask(taskId, {
      total: totalFolders,
      new: newCount,
      existing: existingCount,
      errors: errorCount,
    });
    await lease?.finish(true, getScanTask(taskId));
  } catch (error) {
    logger.error('[OpenList Refresh] 扫描失败:', error);
    failScanTask(taskId, (error as Error).message);
    await lease?.finish(false, getScanTask(taskId)).catch(() => undefined);
    throw error;
  }
}
