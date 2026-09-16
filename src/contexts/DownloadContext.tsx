'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { downloadDB } from '@/lib/download-db';
import { createDownloadUpdates } from '@/lib/download-updates';
import {
  buildIndexedDBVideoCacheKey,
  getBrowserStorageEstimate,
  getIndexedDBVideoCacheSize,
  isIndexedDBVideoDownloaded,
  requestIndexedDBVideoPersistentStorage,
} from '@/lib/indexeddb-video-cache';
import { logger } from '@/lib/logger';
import { M3U8Downloader, M3U8DownloadTask } from '@/lib/m3u8-downloader';

import Toast from '@/components/Toast';

interface DownloadContextType {
  downloader: M3U8Downloader;
  tasks: M3U8DownloadTask[];
  addDownloadTask: (
    url: string,
    title: string,
    type?: 'TS' | 'MP4',
    metadata?: {
      source?: string;
      videoId?: string;
      episodeIndex?: number;
    }
  ) => Promise<void>;
  startTask: (taskId: string) => void;
  pauseTask: (taskId: string) => void;
  cancelTask: (taskId: string) => Promise<void>;
  retryFailedSegments: (taskId: string) => void;
  getProgress: (taskId: string) => number;
  downloadingCount: number;
  showDownloadPanel: boolean;
  setShowDownloadPanel: (show: boolean) => void;
}

type DownloadProgress = Pick<
  DownloadContextType,
  'tasks' | 'downloadingCount' | 'showDownloadPanel'
>;
type DownloadActions = Omit<DownloadContextType, keyof DownloadProgress>;
const DownloadActionsContext = createContext<DownloadActions | undefined>(
  undefined
);
const DownloadProgressContext = createContext<DownloadProgress | undefined>(
  undefined
);

export function DownloadProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<M3U8DownloadTask[]>([]);
  const [showDownloadPanel, setShowDownloadPanel] = useState(false);
  const [, setStartingTaskIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const restoreStarted = useRef(false);
  const [{ downloader, updates, saveTaskNow, startNextPendingTask }] = useState(() => {
    const updates: ReturnType<typeof createDownloadUpdates> = createDownloadUpdates({
      getTasks: () => downloader.getAllTasks(),
      publish: setTasks,
      persist: (changedTasks, deletedIds) => downloadDB.updateActiveTasks(changedTasks, deletedIds),
      onError: (error) => logger.error('保存任务失败:', error),
    });

    const saveTaskNow = (task: M3U8DownloadTask | undefined) => {
      if (task) updates.progress(task);
      return updates.flush();
    };

    // 自动启动下一个等待的任务
    const startNextPendingTask = (currentDownloader: M3U8Downloader) => {
      // 从localStorage读取最大同时下载限制，默认6个
      const maxConcurrentDownloads = typeof window !== 'undefined'
        ? Number(localStorage.getItem('maxConcurrentDownloads') || 6)
        : 6;

      const allTasks = currentDownloader.getAllTasks();
      const downloadingCount = allTasks.filter(t => t.status === 'downloading').length;

      // 如果当前下载数量小于限制，启动下一个ready任务
      if (downloadingCount < maxConcurrentDownloads) {
        const readyTask = allTasks.find(t => t.status === 'ready');
        if (readyTask) {
          currentDownloader.startTask(readyTask.id).then(() => saveTaskNow(readyTask)).catch((error) => logger.error('启动任务失败:', error));
          void saveTaskNow(readyTask);
        }
      }
    };

    const downloader: M3U8Downloader = new M3U8Downloader({
      onProgress: (task) => {
        if (downloader.getTask(task.id) !== task) return;
        updates.progress(task);
      },
      onComplete: async (task) => {
        if (downloader.getTask(task.id) !== task) return;
        void saveTaskNow(task);

        // File System / IndexedDB 模式保存到已完成任务表，用于本地播放命中和下载管理
        if (
          (task.downloadMode === 'filesystem' || task.downloadMode === 'indexeddb') &&
          task.source &&
          task.videoId &&
          task.episodeIndex !== undefined
        ) {
          try {
            // 计算文件大小
            let fileSize: number | undefined;
            if (task.downloadMode === 'filesystem' && task.filesystemDirHandle) {
              try {
                const sourceDirHandle = await task.filesystemDirHandle.getDirectoryHandle(task.source, { create: false });
                const videoIdDirHandle = await sourceDirHandle.getDirectoryHandle(task.videoId, { create: false });
                const epDirHandle = await videoIdDirHandle.getDirectoryHandle(`ep${task.episodeIndex + 1}`, { create: false });

                let totalSize = 0;
                for await (const entry of epDirHandle.values()) {
                  if (entry.kind === 'file') {
                    const fileHandle = entry as FileSystemFileHandle;
                    const file = await fileHandle.getFile();
                    totalSize += file.size;
                  }
                }
                fileSize = totalSize;
              } catch (error) {
                logger.error('计算文件大小失败:', error);
              }
            } else if (task.downloadMode === 'indexeddb') {
              try {
                const cacheKey = task.indexedDBCacheKey || buildIndexedDBVideoCacheKey(
                  task.source,
                  task.videoId,
                  task.episodeIndex
                );
                fileSize = await getIndexedDBVideoCacheSize(cacheKey);
              } catch (error) {
                logger.error('计算 IndexedDB 缓存大小失败:', error);
              }
            }

            await downloadDB.saveCompletedTask({
              id: task.id,
              title: task.title,
              source: task.source,
              videoId: task.videoId,
              episodeIndex: task.episodeIndex,
              completedAt: Date.now(),
              downloadMode: task.downloadMode,
              fileSize,
            });
          } catch (error) {
            logger.error('保存已完成任务失败:', error);
          }
        }

        // 任务完成后，尝试启动下一个等待的任务
        startNextPendingTask(downloader);
      },
      onError: (task, error) => {
        if (downloader.getTask(task.id) !== task) return;
        logger.error('下载错误:', error);
        void saveTaskNow(task);
        // 任务出错后，尝试启动下一个等待的任务
        startNextPendingTask(downloader);
      },
    });
    return { downloader, updates, saveTaskNow, startNextPendingTask };
  });

  useEffect(() => {
    const flush = () => {
      void updates.flush();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void updates.flush(false);
    };
  }, [updates]);

  // 从 IndexedDB 恢复任务
  useEffect(() => {
    if (typeof window === 'undefined' || restoreStarted.current) return;
    restoreStarted.current = true;

    const restoreTasks = async () => {
      try {
        const savedTasks = await downloadDB.getActiveTasks();
        if (!savedTasks || savedTasks.length === 0) return;

        //禁止SzeMeng76抄袭狗抄袭
        // 读取目录句柄：只要存在待恢复的 filesystem 任务就需要尝试读取，
        // 不依赖当前用户下载模式设置。
        const hasFilesystemTask = savedTasks.some((task) => task.downloadMode === 'filesystem');
        let dirHandle: FileSystemDirectoryHandle | undefined;

        if (hasFilesystemTask) {
          const dbName = 'PureTV';
          const storeName = 'dirHandles';

          dirHandle = await new Promise<FileSystemDirectoryHandle | undefined>((resolve) => {
            const request = indexedDB.open(dbName, 2);

            request.onsuccess = (event) => {
              const db = (event.target as IDBOpenDBRequest).result;

              if (!db.objectStoreNames.contains(storeName)) {
                db.close();
                resolve(undefined);
                return;
              }

              const transaction = db.transaction([storeName], 'readonly');
              const store = transaction.objectStore(storeName);
              const getRequest = store.get('downloadDir');

              getRequest.onsuccess = () => {
                const handle = getRequest.result as FileSystemDirectoryHandle | undefined;
                db.close();
                resolve(handle);
              };

              getRequest.onerror = () => {
                db.close();
                resolve(undefined);
              };
            };

            request.onerror = () => {
              resolve(undefined);
            };
          });
        }

        // 收集需要删除的任务 ID
        const tasksToDelete: string[] = [];
        const restoredTasks: M3U8DownloadTask[] = [];

        // 恢复任务
        for (const savedTask of savedTasks) {
          // browser 模式的任务标记为删除
          if (savedTask.downloadMode === 'browser') {
            tasksToDelete.push(savedTask.id);
            continue;
          }

          // 已完成的 filesystem/indexeddb 任务标记为删除（已记录到 completedTasks）
          if (
            (savedTask.downloadMode === 'filesystem' || savedTask.downloadMode === 'indexeddb') &&
            savedTask.status === 'done'
          ) {
            tasksToDelete.push(savedTask.id);
            continue;
          }

          // 只恢复 filesystem/indexeddb 模式的未完成任务
          if (
            (savedTask.downloadMode === 'filesystem' || savedTask.downloadMode === 'indexeddb') &&
            (savedTask.status === 'downloading' || savedTask.status === 'pause' || savedTask.status === 'ready')
          ) {
            try {
              const taskId = await downloader.createTask(
                savedTask.url,
                savedTask.title,
                savedTask.type,
                {
                  source: savedTask.source,
                  videoId: savedTask.videoId,
                  episodeIndex: savedTask.episodeIndex,
                }
              );

              const task = downloader.getTask(taskId);
              if (task) {
                // 恢复任务状态
                task.status = savedTask.status === 'downloading' ? 'pause' : savedTask.status; // 将 downloading 改为 pause
                task.finishList = savedTask.finishList;
                task.downloadIndex = savedTask.downloadIndex;
                task.finishNum = savedTask.finishNum;
                task.errorNum = savedTask.errorNum;
                task.downloadMode = savedTask.downloadMode;
                task.rangeDownload = savedTask.rangeDownload;
                task.segmentLogs = savedTask.segmentLogs || [];
                task.createdAt = savedTask.createdAt;

                if (savedTask.downloadMode === 'indexeddb' && savedTask.source && savedTask.videoId && savedTask.episodeIndex !== undefined) {
                  task.indexedDBCacheKey = buildIndexedDBVideoCacheKey(
                    savedTask.source,
                    savedTask.videoId,
                    savedTask.episodeIndex
                  );
                }

                if (savedTask.downloadMode === 'filesystem' && dirHandle) {
                  task.filesystemDirHandle = dirHandle;
                }
                // createTask generates a new id. Replace the previous record in
                // the same serialized batch so a reload cannot duplicate it.
                restoredTasks.push(task);
                tasksToDelete.push(savedTask.id);
              }
            } catch (error) {
              logger.error('恢复任务失败:', savedTask.title, error);
              // 恢复失败的任务也标记为删除
              tasksToDelete.push(savedTask.id);
            }
          } else {
            // 其他状态的任务标记为删除
            tasksToDelete.push(savedTask.id);
          }
        }

        restoredTasks.forEach((task) => updates.progress(task));
        // 批量删除无效任务
        if (tasksToDelete.length > 0) {
          logger.debug('清理无效任务:', tasksToDelete.length, '个');
          tasksToDelete.forEach((id) => updates.remove(id));
        }

        await updates.flush();
      } catch (error) {
        logger.error('恢复任务失败:', error);
      }
    };

    restoreTasks();
  }, [downloader, updates]);

  const addDownloadTask = useCallback(async (
    url: string,
    title: string,
    type: 'TS' | 'MP4' = 'TS',
    metadata?: {
      source?: string;
      videoId?: string;
      episodeIndex?: number;
    }
  ) => {
    try {
      // 读取下载模式设置
      const downloadMode = typeof window !== 'undefined'
        ? (localStorage.getItem('downloadMode') as 'browser' | 'filesystem' | 'indexeddb') || 'browser'
        : 'browser';

      // 如果是 filesystem 模式，检查是否已经下载过
      if (downloadMode === 'filesystem' && typeof window !== 'undefined' && metadata?.source && metadata?.videoId && metadata?.episodeIndex !== undefined) {
        try {
          const dbName = 'PureTV';
          const storeName = 'dirHandles';

          const alreadyDownloaded = await new Promise<boolean>((resolve) => {
            const request = indexedDB.open(dbName, 2);

            request.onsuccess = async (event) => {
              const db = (event.target as IDBOpenDBRequest).result;

              if (!db.objectStoreNames.contains(storeName)) {
                db.close();
                resolve(false);
                return;
              }

              const transaction = db.transaction([storeName], 'readonly');
              const store = transaction.objectStore(storeName);
              const getRequest = store.get('downloadDir');

              getRequest.onsuccess = async () => {
                const dirHandle = getRequest.result as FileSystemDirectoryHandle | undefined;
                db.close();

                if (!dirHandle) {
                  resolve(false);
                  return;
                }

                try {
                  // 检查子目录和 playlist.m3u8 是否存在
                  const sourceDirHandle = await dirHandle.getDirectoryHandle(metadata.source!, { create: false });
                  const videoIdDirHandle = await sourceDirHandle.getDirectoryHandle(metadata.videoId!, { create: false });
                  const epDirHandle = await videoIdDirHandle.getDirectoryHandle(`ep${metadata.episodeIndex! + 1}`, { create: false });

                  // 只检查 playlist.m3u8 是否存在（它是最后生成的）
                  await epDirHandle.getFileHandle('playlist.m3u8', { create: false });
                  resolve(true);
                } catch {
                  // 目录或文件不存在
                  resolve(false);
                }
              };

              getRequest.onerror = () => {
                db.close();
                resolve(false);
              };
            };

            request.onerror = () => {
              resolve(false);
            };
          });

          if (alreadyDownloaded) {
            logger.debug('视频已下载（文件系统检查），跳过:', title, metadata);
            setToast({ message: `${title} 已经下载过了，无需重复下载`, type: 'info' });
            return;
          }
        } catch (error) {
          logger.error('检查下载状态失败:', error);
        }
      }

      // 如果是 IndexedDB 模式，检查独立视频缓存库是否已有完整缓存
      if (
        downloadMode === 'indexeddb' &&
        typeof window !== 'undefined' &&
        metadata?.source &&
        metadata?.videoId &&
        metadata?.episodeIndex !== undefined
      ) {
        try {
          const alreadyDownloaded = await isIndexedDBVideoDownloaded(
            metadata.source,
            metadata.videoId,
            metadata.episodeIndex
          );

          if (alreadyDownloaded) {
            logger.debug('视频已下载（IndexedDB 缓存检查），跳过:', title, metadata);
            setToast({ message: `${title} 已经缓存过了，无需重复下载`, type: 'info' });
            return;
          }

          // 尽量请求持久化存储；失败不阻塞，后续仍可降级由浏览器管理配额。
          requestIndexedDBVideoPersistentStorage().catch(() => undefined);

          const estimate = await getBrowserStorageEstimate();
          if (estimate?.quota && estimate?.usage) {
            const freeBytes = estimate.quota - estimate.usage;
            // 低于 512MB 时提示风险，但不阻塞下载（实际大小需解析后才准确）。
            if (freeBytes > 0 && freeBytes < 512 * 1024 * 1024) {
              setToast({
                message: '浏览器可用存储空间较低，IndexedDB 缓存可能失败',
                type: 'info',
              });
            }
          }
        } catch (error) {
          logger.error('检查 IndexedDB 下载状态失败:', error);
        }
      }

      const taskId = await downloader.createTask(url, title, type, metadata);

      // 设置下载模式
      const task = downloader.getTask(taskId);
      if (task) {
        task.downloadMode = downloadMode;
        if (
          downloadMode === 'indexeddb' &&
          metadata?.source &&
          metadata?.videoId &&
          metadata?.episodeIndex !== undefined
        ) {
          task.indexedDBCacheKey = buildIndexedDBVideoCacheKey(
            metadata.source,
            metadata.videoId,
            metadata.episodeIndex
          );
        }
      }

      //禁止SzeMeng76抄袭狗抄袭
      // 如果是 filesystem 模式，从 IndexedDB 读取目录句柄
      if (downloadMode === 'filesystem' && typeof window !== 'undefined') {
        try {
          const dbName = 'PureTV';
          const storeName = 'dirHandles';

          // 使用 Promise 包装 IndexedDB 操作，确保在启动任务前完成
          await new Promise<void>((resolve, reject) => {
            const request = indexedDB.open(dbName, 2);

            request.onupgradeneeded = (event) => {
              const db = (event.target as IDBOpenDBRequest).result;
              if (!db.objectStoreNames.contains(storeName)) {
                db.createObjectStore(storeName);
              }
            };

            request.onsuccess = (event) => {
              const db = (event.target as IDBOpenDBRequest).result;

              // 检查 object store 是否存在
              if (!db.objectStoreNames.contains(storeName)) {
                logger.warn('Object store 不存在，跳过读取');
                db.close();
                resolve();
                return;
              }

              const transaction = db.transaction([storeName], 'readonly');
              const store = transaction.objectStore(storeName);
              const getRequest = store.get('downloadDir');

              getRequest.onsuccess = () => {
                const dirHandle = getRequest.result as FileSystemDirectoryHandle | undefined;
                if (dirHandle) {
                  // 更新任务的目录句柄
                  const task = downloader.getTask(taskId);
                  if (task) {
                    task.filesystemDirHandle = dirHandle;
                    logger.debug('已设置 filesystem 目录句柄:', dirHandle.name);
                  }
                } else {
                  logger.warn('未找到保存目录，使用浏览器下载模式');
                  // 如果没有目录句柄，回退到 browser 模式
                  const task = downloader.getTask(taskId);
                  if (task) {
                    task.downloadMode = 'browser';
                  }
                }
                db.close();
                resolve();
              };

              getRequest.onerror = () => {
                db.close();
                reject(new Error('读取目录句柄失败'));
              };
            };

            request.onerror = () => {
              reject(new Error('打开 IndexedDB 失败'));
            };
          });
        } catch (error) {
          logger.error('读取目录句柄失败:', error);
        }
      }

      void saveTaskNow(downloader.getTask(taskId));

      // 从localStorage读取最大同时下载限制，默认6个
      const maxConcurrentDownloads = typeof window !== 'undefined'
        ? Number(localStorage.getItem('maxConcurrentDownloads') || 6)
        : 6;

      // 检查当前正在下载的任务数量（包括正在启动的）
      setStartingTaskIds(prev => {
        const allTasks = downloader.getAllTasks();
        const currentDownloadingCount = allTasks.filter(t => t.status === 'downloading').length;
        const totalActiveCount = currentDownloadingCount + prev.size;

        // 如果未超过限制，标记为正在启动并启动任务
        if (totalActiveCount < maxConcurrentDownloads) {
          const newSet = new Set(prev);
          newSet.add(taskId);

          // 异步启动任务
          downloader.startTask(taskId).then(() => {
            void saveTaskNow(downloader.getTask(taskId));
            // 启动完成后，从正在启动列表中移除
            setStartingTaskIds(current => {
              const updated = new Set(current);
              updated.delete(taskId);
              return updated;
            });
          });

          return newSet;
        }

        // 否则任务保持ready状态，等待其他任务完成后自动启动
        return prev;
      });
    } catch (error) {
      logger.error('添加下载任务失败:', error);
      throw error;
    }
  }, [downloader, saveTaskNow]);

  const startTask = useCallback((taskId: string) => {
    // 从localStorage读取最大同时下载限制，默认6个
    const maxConcurrentDownloads = typeof window !== 'undefined'
      ? Number(localStorage.getItem('maxConcurrentDownloads') || 6)
      : 6;

    const currentDownloadingCount = downloader.getAllTasks().filter(t => t.status === 'downloading').length;

    // 如果未超过限制，启动任务
    if (currentDownloadingCount < maxConcurrentDownloads) {
      downloader.startTask(taskId).then(() => saveTaskNow(downloader.getTask(taskId))).catch((error) => logger.error('启动任务失败:', error));
      void saveTaskNow(downloader.getTask(taskId));
    }
  }, [downloader, saveTaskNow]);

  const pauseTask = useCallback((taskId: string) => {
    downloader.pauseTask(taskId);
    void saveTaskNow(downloader.getTask(taskId));
    // 暂停任务后，尝试启动下一个等待的任务
    startNextPendingTask(downloader);
  }, [downloader, startNextPendingTask, saveTaskNow]);

  const cancelTask = useCallback(async (taskId: string) => {
    await downloader.cancelTask(taskId);
    updates.remove(taskId);
    await updates.flush();
    // 取消任务后，尝试启动下一个等待的任务
    startNextPendingTask(downloader);
  }, [downloader, startNextPendingTask, updates]);

  const retryFailedSegments = useCallback((taskId: string) => {
    downloader.retryFailedSegments(taskId);
    void saveTaskNow(downloader.getTask(taskId));
  }, [downloader, saveTaskNow]);

  const getProgress = useCallback((taskId: string) => {
    return downloader.getProgress(taskId);
  }, [downloader]);

  const downloadingCount = tasks.filter(t => t.status === 'downloading').length;
  const actions = useMemo<DownloadActions>(() => ({
    downloader,
    addDownloadTask,
    startTask,
    pauseTask,
    cancelTask,
    retryFailedSegments,
    getProgress,
    setShowDownloadPanel,
  }), [downloader, addDownloadTask, startTask, pauseTask, cancelTask, retryFailedSegments, getProgress]);
  const progress = useMemo(() => ({ tasks, downloadingCount, showDownloadPanel }), [tasks, downloadingCount, showDownloadPanel]);

  return (
    <DownloadActionsContext.Provider value={actions}>
      <DownloadProgressContext.Provider value={progress}>
        {children}
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </DownloadProgressContext.Provider>
    </DownloadActionsContext.Provider>
  );
}

export function useDownload() {
  return { ...useDownloadActions(), ...useDownloadProgress() };
}

export function useDownloadActions() {
  const context = useContext(DownloadActionsContext);
  if (context === undefined) {
    throw new Error('useDownloadActions must be used within a DownloadProvider');
  }
  return context;
}

export function useDownloadProgress() {
  const context = useContext(DownloadProgressContext);
  if (context === undefined) {
    throw new Error('useDownloadProgress must be used within a DownloadProvider');
  }
  return context;
}
