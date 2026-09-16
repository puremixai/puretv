/* eslint-disable @typescript-eslint/no-explicit-any */

import { AdminConfig } from '@/lib/admin.types';
import { OpenListClient } from '@/lib/openlist.client';
import { submitGoAnimeDownload } from '@/lib/server/go-anime-download';
import { isGoWorkerEnabled } from '@/lib/server/go-worker';

type OpenListOfflineDownloadSource = {
  url: string;
  username: string;
  password: string;
};

function getOfflineDownloadSource(
  config: AdminConfig,
): OpenListOfflineDownloadSource {
  const openlistConfig = config.OpenListConfig;

  if (!openlistConfig?.Enabled) {
    throw new Error('私人影库功能未启用');
  }

  const useCustomSource =
    openlistConfig.OfflineDownloadUseCustomSource === true;
  const source = useCustomSource
    ? {
        url: openlistConfig.OfflineDownloadURL || '',
        username: openlistConfig.OfflineDownloadUsername || '',
        password: openlistConfig.OfflineDownloadPassword || '',
      }
    : {
        url: openlistConfig.URL,
        username: openlistConfig.Username,
        password: openlistConfig.Password,
      };

  if (!source.url || !source.username || !source.password) {
    throw new Error(
      useCustomSource ? '离线下载 OpenList 配置不完整' : 'OpenList 配置不完整',
    );
  }

  return source;
}

export function getOfflineDownloadBasePath(config: AdminConfig): string {
  const path = config.OpenListConfig?.OfflineDownloadPath || '/';
  const normalizedPath = path.replace(/\/$/, '');
  return normalizedPath || '/';
}

export function joinOpenListPath(basePath: string, name: string): string {
  return basePath === '/' ? `/${name}` : `${basePath}/${name}`;
}

export async function addOpenListOfflineDownload(
  config: AdminConfig,
  downloadPath: string,
  url: string,
  tool: string,
  receipt?: { owner: string; key: string; assertActive?: () => void },
) {
  receipt?.assertActive?.();
  const source = getOfflineDownloadSource(config);
  if (receipt && isGoWorkerEnabled('animeDownloads')) {
    return await submitGoAnimeDownload({
      owner: receipt.owner,
      key: receipt.key,
      operation: {
        ...source,
        path: '/api/fs/add_offline_download',
        method: 'POST',
        body: JSON.stringify({ path: downloadPath, urls: [url], tool }),
        headers: {},
      },
    });
  }
  const client = new OpenListClient(
    source.url,
    source.username,
    source.password,
  );
  const token = await (client as any).getToken();
  const openlistUrl = `${source.url.replace(/\/$/, '')}/api/fs/add_offline_download`;

  receipt?.assertActive?.();
  const response = await fetch(openlistUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
    },
    body: JSON.stringify({
      path: downloadPath,
      urls: [url],
      tool,
    }),
  });

  const data = await response.json();

  if (!response.ok || data.code !== 200) {
    throw new Error(data.message || '添加离线下载任务失败');
  }
  return { replayed: false };
}
