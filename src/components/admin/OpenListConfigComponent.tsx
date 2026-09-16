/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

'use client';

import { ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { AdminConfig } from '@/lib/admin.types';
import { adminFetch as fetch } from '@/lib/admin-fetch';

import {
  AlertModal,
  buttonStyles,
  showError,
  showSuccess,
  useAlertModal,
  useLoadingState,
} from '@/components/admin/shared';
import CorrectDialog from '@/components/CorrectDialog';

export const OpenListConfigComponent = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rootPaths, setRootPaths] = useState<string[]>(['/']);
  const [offlineDownloadPath, setOfflineDownloadPath] = useState('/');
  const [offlineDownloadUseCustomSource, setOfflineDownloadUseCustomSource] =
    useState(false);
  const [offlineDownloadUrl, setOfflineDownloadUrl] = useState('');
  const [offlineDownloadUsername, setOfflineDownloadUsername] = useState('');
  const [offlineDownloadPassword, setOfflineDownloadPassword] = useState('');
  const [scanInterval, setScanInterval] = useState(0);
  const [scanMode, setScanMode] = useState<'torrent' | 'name' | 'hybrid'>(
    'hybrid'
  );
  const [disableVideoPreview, setDisableVideoPreview] = useState(false);
  const [pathMetaRows, setPathMetaRows] = useState<
    Array<{
      path: string;
      category: string;
      refresh14m: boolean;
      proxyPlay: boolean;
      proxyCacheMinutes: number;
    }>
  >([]);
  const [videos, setVideos] = useState<any[]>([]);
  const videoRequestId = useRef(0);
  const [loadedVideoConfig, setLoadedVideoConfig] = useState<AdminConfig | null>(
    null
  );
  const [refreshing, setRefreshing] = useState(false);
  const canLoadVideos = Boolean(
    config?.OpenListConfig?.URL &&
      config?.OpenListConfig?.Username &&
      config?.OpenListConfig?.Password
  );
  // Automatic loads belong to a config revision; manual scans have their own lifetime.
  const loadingVideos =
    refreshing || (canLoadVideos && loadedVideoConfig !== config);
  const [scanProgress, setScanProgress] = useState<{
    current: number;
    total: number;
    currentFolder?: string;
  } | null>(null);
  const [correctDialogOpen, setCorrectDialogOpen] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<any | null>(null);
  const [pathMetaDialogOpen, setPathMetaDialogOpen] = useState(false);
  const [pathMetaExpanded, setPathMetaExpanded] = useState<Set<number>>(
    new Set()
  );

  useEffect(() => {
    if (config?.OpenListConfig) {
      setEnabled(config.OpenListConfig.Enabled || false);
      setUrl(config.OpenListConfig.URL || '');
      setUsername(config.OpenListConfig.Username || '');
      setPassword(config.OpenListConfig.Password || '');
      setRootPaths(
        config.OpenListConfig.RootPaths ||
          (config.OpenListConfig.RootPath
            ? [config.OpenListConfig.RootPath]
            : ['/'])
      );
      setOfflineDownloadPath(config.OpenListConfig.OfflineDownloadPath || '/');
      setOfflineDownloadUseCustomSource(
        config.OpenListConfig.OfflineDownloadUseCustomSource || false
      );
      setOfflineDownloadUrl(config.OpenListConfig.OfflineDownloadURL || '');
      setOfflineDownloadUsername(
        config.OpenListConfig.OfflineDownloadUsername || ''
      );
      setOfflineDownloadPassword(
        config.OpenListConfig.OfflineDownloadPassword || ''
      );
      setScanInterval(config.OpenListConfig.ScanInterval || 0);
      setScanMode(config.OpenListConfig.ScanMode || 'hybrid');
      setDisableVideoPreview(
        config.OpenListConfig.DisableVideoPreview || false
      );
      const pathMeta = config.OpenListConfig.PathMeta || {};
      setPathMetaRows(
        Object.entries(pathMeta).map(([path, meta]) => ({
          path,
          category: meta?.category || '',
          refresh14m: Boolean(meta?.refresh14m),
          proxyPlay: Boolean(meta?.proxyPlay),
          proxyCacheMinutes:
            typeof meta?.proxyCacheMinutes === 'number' &&
            meta.proxyCacheMinutes > 0
              ? meta.proxyCacheMinutes
              : 60,
        }))
      );
    }
  }, [config]);

  async function fetchVideos(noCache = false) {
    const requestId = ++videoRequestId.current;
    try {
      const url = `/api/openlist/list?page=1&pageSize=100&includeFailed=true${
        noCache ? '&noCache=true' : ''
      }`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        if (requestId === videoRequestId.current) setVideos(data.list || []);
      }
    } catch (error) {
      console.error('获取视频列表失败:', error);
    }
  }

  useEffect(() => {
    const requestId = ++videoRequestId.current;
    if (!canLoadVideos) return;
    const controller = new AbortController();
    const { signal } = controller;
    void fetch('/api/openlist/list?page=1&pageSize=100&includeFailed=true', {
      signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const data = await response.json();
        if (!signal.aborted && requestId === videoRequestId.current) {
          setVideos(data.list || []);
        }
      })
      .catch((error) => {
        if (!signal.aborted) console.error('获取视频列表失败:', error);
      })
      .finally(() => {
        if (!signal.aborted) setLoadedVideoConfig(config);
      });
    return () => controller.abort();
  }, [config, canLoadVideos]);

  const handleSave = async () => {
    await withLoading('saveOpenList', async () => {
      try {
        // 路径元信息：序列化为 map（匹配时按最长前缀）
        if (pathMetaRows.some((row) => !(row.path || '').trim())) {
          throw new Error('路径元信息中的路径不能为空');
        }
        const pathMetaPayload: Record<
          string,
          {
            category: string;
            refresh14m: boolean;
            proxyPlay: boolean;
            proxyCacheMinutes: number;
          }
        > = {};
        for (const row of pathMetaRows) {
          const p = (row.path || '').trim();
          pathMetaPayload[p] = {
            category: (row.category || '').trim(),
            refresh14m: Boolean(row.refresh14m),
            proxyPlay: Boolean(row.proxyPlay),
            proxyCacheMinutes:
              typeof row.proxyCacheMinutes === 'number' &&
              row.proxyCacheMinutes > 0
                ? Math.min(Math.max(Math.round(row.proxyCacheMinutes), 1), 1440)
                : 60,
          };
        }

        const response = await fetch('/api/admin/openlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'save',
            Enabled: enabled,
            URL: url,
            Username: username,
            Password: password,
            RootPaths: rootPaths,
            OfflineDownloadPath: offlineDownloadPath,
            OfflineDownloadUseCustomSource: offlineDownloadUseCustomSource,
            OfflineDownloadURL: offlineDownloadUrl,
            OfflineDownloadUsername: offlineDownloadUsername,
            OfflineDownloadPassword: offlineDownloadPassword,
            ScanInterval: scanInterval,
            ScanMode: scanMode,
            DisableVideoPreview: disableVideoPreview,
            PathMeta: pathMetaPayload,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || '保存失败');
        }

        showSuccess('保存成功', showAlert);
        await refreshConfig();
      } catch (error) {
        showError(
          error instanceof Error ? error.message : '保存失败',
          showAlert
        );
        throw error;
      }
    });
  };

  const handleRefresh = async (clearMetaInfo = false) => {
    setRefreshing(true);
    setScanProgress(null);
    try {
      const response = await fetch('/api/openlist/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearMetaInfo }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '刷新失败');
      }

      const result = await response.json();
      const taskId = result.taskId;

      if (!taskId) {
        throw new Error('未获取到任务ID');
      }

      // 轮询任务进度
      const pollInterval = setInterval(async () => {
        try {
          const progressResponse = await fetch(
            `/api/openlist/scan-progress?taskId=${taskId}`
          );

          if (!progressResponse.ok) {
            clearInterval(pollInterval);
            throw new Error('获取进度失败');
          }

          const progressData = await progressResponse.json();
          const task = progressData.task;

          if (task.status === 'running') {
            setScanProgress(task.progress);
          } else if (task.status === 'completed') {
            clearInterval(pollInterval);
            setScanProgress(null);
            showSuccess(
              `扫描完成！新增 ${task.result.new} 个，已存在 ${task.result.existing} 个，失败 ${task.result.errors} 个`,
              showAlert
            );
            // 先强制从数据库读取视频列表（这会更新缓存）
            await fetchVideos(true);
            // 然后再刷新配置（这会触发 useEffect，但此时缓存已经是新的了）
            await refreshConfig();
            setRefreshing(false);
          } else if (task.status === 'failed') {
            clearInterval(pollInterval);
            setScanProgress(null);
            setRefreshing(false);
            throw new Error(task.error || '扫描失败');
          }
        } catch (error) {
          clearInterval(pollInterval);
          setScanProgress(null);
          setRefreshing(false);
          showError(
            error instanceof Error ? error.message : '获取进度失败',
            showAlert
          );
        }
      }, 1000);
    } catch (error) {
      setScanProgress(null);
      setRefreshing(false);
      showError(error instanceof Error ? error.message : '刷新失败', showAlert);
    }
  };

  const handleRefreshVideo = async (folder: string) => {
    try {
      const response = await fetch('/api/openlist/refresh-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '刷新失败');
      }

      showSuccess('刷新成功', showAlert);
    } catch (error) {
      showError(error instanceof Error ? error.message : '刷新失败', showAlert);
    }
  };

  const handleCorrectSuccess = async () => {
    setRefreshing(true);
    try {
      await fetchVideos(true); // 强制从数据库重新读取，不使用缓存
    } finally {
      setRefreshing(false);
    }
  };

  const handleCheckConnectivity = async () => {
    await withLoading('checkOpenList', async () => {
      try {
        const response = await fetch('/api/openlist/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url,
            username,
            password,
          }),
        });

        const data = await response.json();

        if (response.ok && data.success) {
          showSuccess('连接成功', showAlert);
        } else {
          throw new Error(data.error || '连接失败');
        }
      } catch (error) {
        showError(
          error instanceof Error ? error.message : '连接失败',
          showAlert
        );
        throw error;
      }
    });
  };

  const handleDeleteVideo = async (key: string, title: string) => {
    // 显示确认对话框，直接在 onConfirm 中执行删除操作
    showAlert({
      type: 'warning',
      title: '确认删除',
      message: `确定要删除视频记录"${title}"吗？此操作不会删除实际文件，只会从列表中移除。`,
      showConfirm: true,
      onConfirm: async () => {
        try {
          const response = await fetch('/api/openlist/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key }),
          });

          if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || '删除失败');
          }

          showSuccess('删除成功', showAlert);
          setRefreshing(true);
          try {
            await fetchVideos(true); // 强制从数据库重新读取
          } finally {
            setRefreshing(false);
          }
          refreshConfig(); // 异步刷新配置以更新资源数量（不等待，避免重复刷新）
        } catch (error) {
          showError(
            error instanceof Error ? error.message : '删除失败',
            showAlert
          );
        }
      },
    });
  };

  const formatDate = (timestamp?: number) => {
    if (!timestamp) return '未刷新';
    return new Date(timestamp).toLocaleString('zh-CN');
  };

  return (
    <div className='space-y-6'>
      {/* 使用说明 */}
      <div className='bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4'>
        <div className='flex items-center gap-2 mb-2'>
          <svg
            className='w-5 h-5 text-blue-600 dark:text-blue-400'
            fill='none'
            stroke='currentColor'
            viewBox='0 0 24 24'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
            />
          </svg>
          <span className='text-sm font-medium text-blue-800 dark:text-blue-300'>
            使用说明
          </span>
        </div>
        <div className='text-sm text-blue-700 dark:text-blue-400 space-y-1'>
          <p>
            • 私人影库功能需要配合 OpenList 使用，用于管理和播放您自己的视频文件
          </p>
          <p>
            • OpenList
            是一个开源的网盘聚合程序，支持多种存储后端（本地、阿里云盘、OneDrive
            等）
          </p>
          <p>
            • 配置后，系统会自动扫描指定目录下的视频文件夹，并通过 TMDB
            匹配元数据信息
          </p>
          <p>• 定时扫描间隔设置为 0 表示关闭自动扫描，最低间隔为 60 分钟</p>
          <p>• 视频文件夹名称为影片名称，精准命名可以提高 TMDB 匹配准确率</p>
        </div>
      </div>

      {/* 功能开关 */}
      <div className='flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700'>
        <div>
          <h3 className='text-sm font-medium text-gray-900 dark:text-gray-100'>
            启用私人影库功能
          </h3>
          <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
            关闭后将不显示私人影库入口，也不会执行定时扫描
          </p>
        </div>
        <label className='relative inline-flex items-center cursor-pointer'>
          <input
            type='checkbox'
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className='sr-only peer'
          />
          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-hidden peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:rtl:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:inset-s-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
        </label>
      </div>

      {/* 配置表单 */}
      <div className='space-y-4'>
        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            OpenList URL
          </label>
          <input
            type='text'
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={!enabled}
            placeholder='https://your-openlist-server.com'
            className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed'
          />
        </div>

        <div className='grid grid-cols-2 gap-4'>
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              账号
            </label>
            <input
              type='text'
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={!enabled}
              placeholder='admin'
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed'
            />
          </div>
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              密码
            </label>
            <input
              type='password'
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={!enabled}
              placeholder='password'
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed'
            />
          </div>
        </div>

        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            根目录列表
          </label>
          <div className='space-y-2'>
            {rootPaths.map((path, index) => (
              <div key={index} className='flex gap-2'>
                <input
                  type='text'
                  value={path}
                  onChange={(e) => {
                    const newPaths = [...rootPaths];
                    newPaths[index] = e.target.value;
                    setRootPaths(newPaths);
                  }}
                  disabled={!enabled}
                  placeholder='/'
                  className='flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed'
                />
                {rootPaths.length > 1 && (
                  <button
                    type='button'
                    onClick={() => {
                      const newPaths = rootPaths.filter((_, i) => i !== index);
                      setRootPaths(newPaths);
                    }}
                    disabled={!enabled}
                    className='px-3 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed'
                  >
                    删除
                  </button>
                )}
              </div>
            ))}
            <button
              type='button'
              onClick={() => setRootPaths([...rootPaths, '/'])}
              disabled={!enabled}
              className='w-full px-3 py-2 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-400 hover:border-blue-500 hover:text-blue-500 disabled:opacity-50 disabled:cursor-not-allowed'
            >
              + 添加根目录
            </button>
          </div>
          <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
            OpenList 中的视频文件夹路径，可以配置多个根目录
          </p>
        </div>

        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            离线下载目录
          </label>
          <input
            type='text'
            value={offlineDownloadPath}
            onChange={(e) => setOfflineDownloadPath(e.target.value)}
            disabled={!enabled}
            placeholder='/'
            className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed'
          />
          <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
            动漫磁力等离线下载任务的保存目录，默认为根目录 /
          </p>
        </div>

        <div className='space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800'>
          <div className='flex items-center justify-between'>
            <div>
              <h3 className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                离线下载使用独立 OpenList 源
              </h3>
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                开启后，存到私人影库和追番订阅会把任务提交到下方
                OpenList，扫描和播放仍使用上方主 OpenList
              </p>
            </div>
            <button
              type='button'
              onClick={() =>
                setOfflineDownloadUseCustomSource(
                  !offlineDownloadUseCustomSource
                )
              }
              disabled={!enabled}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                offlineDownloadUseCustomSource
                  ? 'bg-blue-600'
                  : 'bg-gray-200 dark:bg-gray-700'
              } ${!enabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  offlineDownloadUseCustomSource
                    ? 'translate-x-6'
                    : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {offlineDownloadUseCustomSource && (
            <div className='space-y-4'>
              <div>
                <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                  离线下载 OpenList URL
                </label>
                <input
                  type='text'
                  value={offlineDownloadUrl}
                  onChange={(e) => setOfflineDownloadUrl(e.target.value)}
                  disabled={!enabled}
                  placeholder='https://download-openlist-server.com'
                  className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed'
                />
              </div>

              <div className='grid grid-cols-2 gap-4'>
                <div>
                  <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                    离线下载账号
                  </label>
                  <input
                    type='text'
                    value={offlineDownloadUsername}
                    onChange={(e) => setOfflineDownloadUsername(e.target.value)}
                    disabled={!enabled}
                    placeholder='admin'
                    className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed'
                  />
                </div>
                <div>
                  <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                    离线下载密码
                  </label>
                  <input
                    type='password'
                    value={offlineDownloadPassword}
                    onChange={(e) => setOfflineDownloadPassword(e.target.value)}
                    disabled={!enabled}
                    placeholder='password'
                    className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed'
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            定时扫描间隔（分钟）
          </label>
          <input
            type='number'
            value={scanInterval}
            onChange={(e) => setScanInterval(parseInt(e.target.value) || 0)}
            disabled={!enabled}
            placeholder='0'
            min='0'
            className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed'
          />
          <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
            设置为 0 关闭定时扫描，最低 60 分钟
          </p>
        </div>

        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            扫描模式
          </label>
          <select
            value={scanMode}
            onChange={(e) =>
              setScanMode(e.target.value as 'torrent' | 'name' | 'hybrid')
            }
            disabled={!enabled}
            className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed'
          >
            <option value='hybrid'>混合模式（推荐）</option>
            <option value='torrent'>种子库匹配</option>
            <option value='name'>名字匹配</option>
          </select>
          <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
            混合模式：先用种子库匹配，失败后降级为名字匹配
          </p>
        </div>

        <div className='flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700'>
          <div>
            <h3 className='text-sm font-medium text-gray-900 dark:text-white'>
              禁用预览视频
            </h3>
            <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
              开启后将直接返回直连链接，不使用视频预览流
            </p>
          </div>
          <button
            onClick={() => setDisableVideoPreview(!disableVideoPreview)}
            disabled={!enabled}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              disableVideoPreview
                ? 'bg-blue-600'
                : 'bg-gray-200 dark:bg-gray-700'
            } ${!enabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                disableVideoPreview ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        <div className='flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700'>
          <div>
            <h3 className='text-sm font-medium text-gray-900 dark:text-white'>
              路径元信息
            </h3>
            <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
              为指定路径下的影片设置分类、播放时是否自动刷新链接（约 14 分钟），
              以及是否通过服务器代理播放（可配置链接缓存时长）
              {pathMetaRows.length > 0
                ? ` · 已配置 ${pathMetaRows.length} 条`
                : ''}
            </p>
          </div>
          <button
            type='button'
            onClick={() => setPathMetaDialogOpen(true)}
            disabled={!enabled}
            className={`${buttonStyles.primary} text-sm ${
              !enabled ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            设置
          </button>
        </div>

        {pathMetaDialogOpen &&
          createPortal(
            <div
              className='fixed inset-0 bg-black/50 z-10002 flex items-center justify-center p-4'
              onClick={() => setPathMetaDialogOpen(false)}
              onTouchMove={(e) => e.preventDefault()}
              onWheel={(e) => e.preventDefault()}
              style={{ touchAction: 'none' }}
            >
              <div
                className='w-full max-w-3xl max-h-[85vh] flex flex-col rounded-xl bg-white dark:bg-gray-900 shadow-xl border border-gray-200 dark:border-gray-700'
                onClick={(e) => e.stopPropagation()}
                onTouchMove={(e) => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
                style={{ touchAction: 'auto' }}
              >
                <div className='flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700'>
                  <h3 className='text-base font-medium text-gray-900 dark:text-white'>
                    路径元信息
                  </h3>
                  <button
                    type='button'
                    onClick={() => setPathMetaDialogOpen(false)}
                    className='text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-sm px-2 py-1'
                  >
                    关闭
                  </button>
                </div>

                <div className='px-5 py-3 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800'>
                  填写目录路径即可作用于其下所有影片（如
                  /videos）。更具体的路径优先。改完后点「保存配置」才会生效。
                </div>

                <div className='flex-1 overflow-y-auto px-5 py-4 space-y-2'>
                  {pathMetaRows.length === 0 ? (
                    <p className='text-sm text-gray-400 dark:text-gray-500 text-center py-8'>
                      暂无配置，点击下方「添加」开始
                    </p>
                  ) : (
                    pathMetaRows.map((row, index) => {
                      const expanded = pathMetaExpanded.has(index);
                      return (
                        <div
                          key={index}
                          className='border border-gray-200 dark:border-gray-700 rounded-lg'
                        >
                          {/* 折叠头部：路径 + 展开箭头 + 删除 */}
                          <div className='flex items-center gap-2 px-3 py-2'>
                            <button
                              type='button'
                              onClick={() =>
                                setPathMetaExpanded((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(index)) {
                                    next.delete(index);
                                  } else {
                                    next.add(index);
                                  }
                                  return next;
                                })
                              }
                              className='shrink-0 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                              aria-label={expanded ? '收起' : '展开'}
                            >
                              {expanded ? (
                                <ChevronUp className='h-4 w-4' />
                              ) : (
                                <ChevronDown className='h-4 w-4' />
                              )}
                            </button>
                            <input
                              type='text'
                              value={row.path}
                              onChange={(e) => {
                                const value = e.target.value;
                                setPathMetaRows((rows) =>
                                  rows.map((r, i) =>
                                    i === index ? { ...r, path: value } : r
                                  )
                                );
                              }}
                              placeholder='路径，如 /videos'
                              className='flex-1 min-w-0 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent'
                            />
                            <button
                              type='button'
                              onClick={() =>
                                setPathMetaRows((rows) =>
                                  rows.filter((_, i) => i !== index)
                                )
                              }
                              className='shrink-0 px-2 py-1 text-sm text-red-600 hover:text-red-700 dark:text-red-400'
                            >
                              删除
                            </button>
                          </div>

                          {/* 展开配置区：分类、自动刷新、代理播放、代理缓存时长 */}
                          {expanded && (
                            <div className='border-t border-gray-200 dark:border-gray-700 px-3 py-3 space-y-3'>
                              <div>
                                <label className='block text-xs text-gray-500 dark:text-gray-400 mb-1'>
                                  分类
                                </label>
                                <input
                                  type='text'
                                  value={row.category}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    setPathMetaRows((rows) =>
                                      rows.map((r, i) =>
                                        i === index
                                          ? { ...r, category: value }
                                          : r
                                      )
                                    );
                                  }}
                                  placeholder='分类，如 动漫'
                                  className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent'
                                />
                              </div>

                              <div className='flex items-center justify-between'>
                                <span className='text-sm text-gray-700 dark:text-gray-300'>
                                  播放自动刷新
                                  <span className='block text-xs text-gray-400 dark:text-gray-500'>
                                    播放时约 14 分钟自动刷新链接
                                  </span>
                                </span>
                                <button
                                  type='button'
                                  onClick={() =>
                                    setPathMetaRows((rows) =>
                                      rows.map((r, i) =>
                                        i === index
                                          ? {
                                              ...r,
                                              refresh14m: !r.refresh14m,
                                            }
                                          : r
                                      )
                                    )
                                  }
                                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                                    row.refresh14m
                                      ? 'bg-blue-600'
                                      : 'bg-gray-200 dark:bg-gray-700'
                                  }`}
                                  aria-label='播放自动刷新'
                                >
                                  <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                      row.refresh14m
                                        ? 'translate-x-6'
                                        : 'translate-x-1'
                                    }`}
                                  />
                                </button>
                              </div>

                              <div className='flex items-center justify-between'>
                                <span className='text-sm text-gray-700 dark:text-gray-300'>
                                  代理播放
                                  <span className='block text-xs text-gray-400 dark:text-gray-500'>
                                    播放链接通过服务器代理
                                  </span>
                                </span>
                                <button
                                  type='button'
                                  onClick={() =>
                                    setPathMetaRows((rows) =>
                                      rows.map((r, i) =>
                                        i === index
                                          ? {
                                              ...r,
                                              proxyPlay: !r.proxyPlay,
                                            }
                                          : r
                                      )
                                    )
                                  }
                                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                                    row.proxyPlay
                                      ? 'bg-blue-600'
                                      : 'bg-gray-200 dark:bg-gray-700'
                                  }`}
                                  aria-label='代理播放'
                                >
                                  <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                      row.proxyPlay
                                        ? 'translate-x-6'
                                        : 'translate-x-1'
                                    }`}
                                  />
                                </button>
                              </div>

                              <div className='flex items-center gap-2'>
                                <label className='text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap'>
                                  代理缓存时长（分钟）
                                </label>
                                <input
                                  type='number'
                                  min={1}
                                  max={1440}
                                  value={row.proxyCacheMinutes}
                                  onChange={(e) => {
                                    const value = parseInt(e.target.value, 10);
                                    setPathMetaRows((rows) =>
                                      rows.map((r, i) =>
                                        i === index
                                          ? {
                                              ...r,
                                              proxyCacheMinutes:
                                                Number.isFinite(value)
                                                  ? value
                                                  : 60,
                                            }
                                          : r
                                      )
                                    );
                                  }}
                                  placeholder='60'
                                  className='w-24 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent'
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                <div className='flex items-center justify-between gap-3 px-5 py-4 border-t border-gray-200 dark:border-gray-700'>
                  <button
                    type='button'
                    onClick={() => {
                      setPathMetaRows((rows) => [
                        ...rows,
                        {
                          path: '',
                          category: '',
                          refresh14m: false,
                          proxyPlay: false,
                          proxyCacheMinutes: 60,
                        },
                      ]);
                      // 新添加的行默认展开，便于直接配置
                      setPathMetaExpanded((prev) => {
                        const next = new Set(prev);
                        next.add(pathMetaRows.length);
                        return next;
                      });
                    }}
                    className={buttonStyles.primary}
                  >
                    添加
                  </button>
                  <button
                    type='button'
                    onClick={() => {
                      if (
                        pathMetaRows.some((row) => !(row.path || '').trim())
                      ) {
                        showError('路径不能为空', showAlert);
                        return;
                      }
                      setPathMetaDialogOpen(false);
                    }}
                    className={buttonStyles.success}
                  >
                    完成
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )}

        <div className='flex gap-3'>
          <button
            onClick={handleCheckConnectivity}
            disabled={
              !enabled ||
              !url ||
              !username ||
              !password ||
              isLoading('checkOpenList')
            }
            className={buttonStyles.primary}
          >
            {isLoading('checkOpenList') ? '检查中...' : '检查连通性'}
          </button>
          <button
            onClick={handleSave}
            disabled={isLoading('saveOpenList')}
            className={buttonStyles.success}
          >
            {isLoading('saveOpenList') ? '保存中...' : '保存配置'}
          </button>
        </div>
      </div>

      {/* 视频列表区域 */}
      {enabled &&
        config?.OpenListConfig?.URL &&
        config?.OpenListConfig?.Username &&
        config?.OpenListConfig?.Password && (
          <div className='space-y-4'>
            <div className='flex items-center justify-between'>
              <div>
                <h3 className='text-lg font-medium text-gray-900 dark:text-gray-100'>
                  视频列表
                </h3>
                <div className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
                  <span>
                    资源数: {config.OpenListConfig.ResourceCount || 0}
                  </span>
                  <span className='mx-2'>|</span>
                  <span>
                    上次更新:{' '}
                    {formatDate(config.OpenListConfig.LastRefreshTime)}
                  </span>
                </div>
              </div>
              <div className='flex gap-3'>
                <button
                  onClick={() => handleRefresh(true)}
                  disabled={loadingVideos}
                  className={buttonStyles.warning}
                >
                  {loadingVideos ? '扫描中...' : '重新扫描'}
                </button>
                <button
                  onClick={() => handleRefresh(false)}
                  disabled={loadingVideos}
                  className={buttonStyles.primary}
                >
                  {loadingVideos ? '扫描中...' : '立即扫描'}
                </button>
              </div>
            </div>

            {refreshing && scanProgress && (
              <div className='bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4'>
                <div className='flex items-center justify-between mb-2'>
                  <span className='text-sm font-medium text-blue-900 dark:text-blue-100'>
                    扫描进度: {scanProgress.current} / {scanProgress.total}
                  </span>
                  <span className='text-sm text-blue-700 dark:text-blue-300'>
                    {scanProgress.total > 0
                      ? Math.round(
                          (scanProgress.current / scanProgress.total) * 100
                        )
                      : 0}
                    %
                  </span>
                </div>
                <div className='w-full bg-blue-200 dark:bg-blue-800 rounded-full h-2 mb-2'>
                  <div
                    className='bg-blue-600 dark:bg-blue-500 h-2 rounded-full transition-all duration-300'
                    style={{
                      width: `${
                        scanProgress.total > 0
                          ? (scanProgress.current / scanProgress.total) * 100
                          : 0
                      }%`,
                    }}
                  />
                </div>
                {scanProgress.currentFolder && (
                  <p className='text-xs text-blue-700 dark:text-blue-300'>
                    正在处理: {scanProgress.currentFolder}
                  </p>
                )}
              </div>
            )}

            {loadingVideos ? (
              <div className='text-center py-8 text-gray-500 dark:text-gray-400'>
                加载中...
              </div>
            ) : videos.length > 0 ? (
              <div className='overflow-x-auto'>
                <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
                  <thead className='bg-gray-50 dark:bg-gray-800'>
                    <tr>
                      <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                        标题
                      </th>
                      <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                        状态
                      </th>
                      <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                        类型
                      </th>
                      <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                        季度
                      </th>
                      <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                        年份
                      </th>
                      <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                        评分
                      </th>
                      <th className='px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody className='bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700'>
                    {videos.map((video) => (
                      <tr
                        key={video.id}
                        className={
                          video.failed ? 'bg-red-50 dark:bg-red-900/10' : ''
                        }
                      >
                        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
                          {video.title}
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap text-sm'>
                          {video.failed ? (
                            <span className='inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'>
                              匹配失败
                            </span>
                          ) : (
                            <span className='inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200'>
                              正常
                            </span>
                          )}
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400'>
                          {video.mediaType === 'movie' ? '电影' : '剧集'}
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400'>
                          {video.seasonNumber ? (
                            <span
                              className='inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'
                              title={
                                video.seasonName || `第${video.seasonNumber}季`
                              }
                            >
                              S{video.seasonNumber}
                            </span>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400'>
                          {video.releaseDate
                            ? video.releaseDate.split('-')[0]
                            : '-'}
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400'>
                          {video.voteAverage > 0
                            ? video.voteAverage.toFixed(1)
                            : '-'}
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap text-right text-sm'>
                          <div className='flex gap-2 justify-end'>
                            {!video.failed && (
                              <button
                                onClick={() => handleRefreshVideo(video.folder)}
                                className={buttonStyles.primarySmall}
                              >
                                刷新
                              </button>
                            )}
                            <button
                              onClick={() => {
                                console.log('Video object:', video);
                                console.log(
                                  'Video poster field:',
                                  video.poster
                                );
                                setSelectedVideo(video);
                                setCorrectDialogOpen(true);
                              }}
                              className={
                                video.failed
                                  ? buttonStyles.warningSmall
                                  : buttonStyles.successSmall
                              }
                            >
                              {video.failed ? '立即纠错' : '纠错'}
                            </button>
                            <button
                              onClick={() =>
                                handleDeleteVideo(video.id, video.title)
                              }
                              className={buttonStyles.dangerSmall}
                            >
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className='text-center py-8 text-gray-500 dark:text-gray-400'>
                暂无视频，请点击"立即扫描"扫描视频库
              </div>
            )}
          </div>
        )}

      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
        onConfirm={alertModal.onConfirm}
      />

      {/* 纠错对话框 */}
      {selectedVideo && (
        <CorrectDialog
          isOpen={correctDialogOpen}
          onClose={() => setCorrectDialogOpen(false)}
          videoKey={selectedVideo.id}
          currentTitle={selectedVideo.title}
          currentVideo={{
            tmdbId: selectedVideo.tmdbId,
            doubanId: selectedVideo.doubanId,
            poster: selectedVideo.poster,
            releaseDate: selectedVideo.releaseDate,
            overview: selectedVideo.overview,
            voteAverage: selectedVideo.voteAverage,
            mediaType: selectedVideo.mediaType,
            seasonNumber: selectedVideo.seasonNumber,
            seasonName: selectedVideo.seasonName,
          }}
          onCorrect={handleCorrectSuccess}
        />
      )}
    </div>
  );
};
