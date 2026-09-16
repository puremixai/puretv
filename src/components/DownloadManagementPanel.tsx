'use client';

import { Check, ChevronDown, Download, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { CompletedTask,downloadDB } from '@/lib/download-db';
import {
  buildIndexedDBVideoCacheKey,
  deleteIndexedDBVideoCacheByEpisode,
  getIndexedDBVideoManifestByEpisode,
  getIndexedDBVideoSegments,
} from '@/lib/indexeddb-video-cache';
import { logger } from '@/lib/logger';

import { createCinemaPortal as createPortal } from '@/components/CinemaPortal';

import { ConfirmDialog } from './ConfirmDialog';

interface DownloadManagementPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

interface VideoDownloadGroup {
  key: string;
  source: string;
  videoId: string;
  title: string;
  tasks: CompletedTask[];
  totalSize?: number;
  lastCompletedAt: number;
  downloadModes: CompletedTask['downloadMode'][];
}

export function DownloadManagementPanel({
  isOpen,
  onClose,
}: DownloadManagementPanelProps) {
  const [completedTasks, setCompletedTasks] = useState<CompletedTask[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(
    new Set()
  );
  const [isDeleting, setIsDeleting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  async function loadCompletedTasks() {
    try {
      const tasks = await downloadDB.getCompletedTasks();
      setCompletedTasks(tasks);
    } catch (error) {
      logger.error('加载已完成任务失败:', error);
    }
  }

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    downloadDB.getCompletedTasks()
      .then((tasks) => {
        if (!cancelled) setCompletedTasks(tasks);
      })
      .catch((error) => {
        if (!cancelled) logger.error('加载已完成任务失败:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const handleSelectAll = () => {
    if (selectedIds.size === completedTasks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(completedTasks.map((t) => t.id)));
    }
  };

  const handleToggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const handleToggleGroupSelect = (group: VideoDownloadGroup) => {
    const newSet = new Set(selectedIds);
    const allSelected = group.tasks.every((task) => newSet.has(task.id));

    if (allSelected) {
      group.tasks.forEach((task) => newSet.delete(task.id));
    } else {
      group.tasks.forEach((task) => newSet.add(task.id));
    }

    setSelectedIds(newSet);
  };

  const handleToggleGroupExpand = (groupKey: string) => {
    const newSet = new Set(expandedGroupKeys);
    if (newSet.has(groupKey)) {
      newSet.delete(groupKey);
    } else {
      newSet.add(groupKey);
    }
    setExpandedGroupKeys(newSet);
  };

  const handleDelete = async () => {
    if (selectedIds.size === 0) return;

    setShowConfirmDialog(true);
  };

  const handleConfirmDelete = async () => {
    setShowConfirmDialog(false);
    setIsDeleting(true);
    try {
      // 获取要删除的任务
      const tasksToDelete = completedTasks.filter((t) => selectedIds.has(t.id));

      //禁止SzeMeng76抄袭狗抄袭
      // 删除文件系统中的文件
      for (const task of tasksToDelete) {
        if (task.downloadMode === 'filesystem') {
          try {
            // 从 IndexedDB 读取目录句柄
            const dbName = 'PureTV';
            const storeName = 'dirHandles';

            const dirHandle = await new Promise<
              FileSystemDirectoryHandle | undefined
            >((resolve) => {
              const request = indexedDB.open(dbName, 2); // 使用版本 2

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
                  const handle = getRequest.result as
                    | FileSystemDirectoryHandle
                    | undefined;
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

            if (dirHandle) {
              // 请求写权限
              const permission = await dirHandle.requestPermission({
                mode: 'readwrite',
              });
              if (permission !== 'granted') {
                logger.error('未获得写权限，无法删除文件');
                continue;
              }

              // 删除目录
              try {
                const sourceDirHandle = await dirHandle.getDirectoryHandle(
                  task.source,
                  { create: false }
                );
                const videoIdDirHandle =
                  await sourceDirHandle.getDirectoryHandle(task.videoId, {
                    create: false,
                  });
                await videoIdDirHandle.removeEntry(
                  `ep${task.episodeIndex + 1}`,
                  { recursive: true }
                );
                logger.debug(
                  '已删除文件:',
                  task.source,
                  task.videoId,
                  `ep${task.episodeIndex + 1}`
                );
              } catch (deleteError) {
                logger.error('删除目录失败:', deleteError);
                // 如果目录不存在，也算成功
                if ((deleteError as Error).name !== 'NotFoundError') {
                  throw deleteError;
                }
              }
            }
          } catch (error) {
            logger.error('删除文件失败:', task.title, error);
          }
        } else if (task.downloadMode === 'indexeddb') {
          try {
            await deleteIndexedDBVideoCacheByEpisode(
              task.source,
              task.videoId,
              task.episodeIndex
            );
            logger.debug(
              '已删除 IndexedDB 视频缓存:',
              task.source,
              task.videoId,
              task.episodeIndex
            );
          } catch (error) {
            logger.error('删除 IndexedDB 视频缓存失败:', task.title, error);
          }
        }
      }

      // 从数据库删除记录
      await downloadDB.deleteCompletedTasks(Array.from(selectedIds));
      await loadCompletedTasks();
      setSelectedIds(new Set());
    } catch (error) {
      logger.error('删除任务失败:', error);
      alert('删除失败，请重试');
    } finally {
      setIsDeleting(false);
    }
  };

  const sanitizeFilename = (name: string) => {
    return (
      name
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120) || 'download'
    );
  };

  const triggerBlobDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const getTaskExportFilename = (
    task: CompletedTask,
    usedFilenames: Set<string>
  ) => {
    const episodeLabel = `第${task.episodeIndex + 1}集`;
    const baseTitle = task.videoTitle || getGroupTitle([task]);
    const episodeTitle = task.episodeTitle
      ? `${episodeLabel}_${task.episodeTitle}`
      : episodeLabel;
    const baseFilename = sanitizeFilename(`${baseTitle}_${episodeTitle}`);
    let filename = `${baseFilename}.ts`;
    let duplicateIndex = 2;

    while (usedFilenames.has(filename)) {
      filename = `${baseFilename}_${duplicateIndex}.ts`;
      duplicateIndex += 1;
    }

    usedFilenames.add(filename);
    return filename;
  };

  const getStoredDownloadDirHandle = async (): Promise<
    FileSystemDirectoryHandle | undefined
  > => {
    const dbName = 'PureTV';
    const storeName = 'dirHandles';

    return new Promise<FileSystemDirectoryHandle | undefined>((resolve) => {
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
          const handle = getRequest.result as
            | FileSystemDirectoryHandle
            | undefined;
          db.close();
          resolve(handle);
        };

        getRequest.onerror = () => {
          db.close();
          resolve(undefined);
        };
      };

      request.onerror = () => resolve(undefined);
    });
  };

  const readFilesystemTaskAsBlobParts = async (
    task: CompletedTask,
    dirHandle: FileSystemDirectoryHandle
  ): Promise<BlobPart[]> => {
    const sourceDirHandle = await dirHandle.getDirectoryHandle(task.source, {
      create: false,
    });
    const videoIdDirHandle = await sourceDirHandle.getDirectoryHandle(
      task.videoId,
      { create: false }
    );
    const epDirHandle = await videoIdDirHandle.getDirectoryHandle(
      `ep${task.episodeIndex + 1}`,
      { create: false }
    );

    const segmentFiles: Array<{ name: string; file: File }> = [];
    for await (const entry of epDirHandle.values()) {
      if (entry.kind === 'file' && /^segment_\d+\.ts$/i.test(entry.name)) {
        const fileHandle = entry as FileSystemFileHandle;
        segmentFiles.push({
          name: entry.name,
          file: await fileHandle.getFile(),
        });
      }
    }

    segmentFiles.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true })
    );

    if (segmentFiles.length === 0) {
      throw new Error('未找到可导出的分片文件');
    }

    return segmentFiles.map(({ file }) => file);
  };

  const readIndexedDBTaskAsBlobParts = async (
    task: CompletedTask
  ): Promise<BlobPart[]> => {
    const manifest = await getIndexedDBVideoManifestByEpisode(
      task.source,
      task.videoId,
      task.episodeIndex
    );
    const cacheKey =
      manifest?.cacheKey ||
      buildIndexedDBVideoCacheKey(task.source, task.videoId, task.episodeIndex);
    const segments = await getIndexedDBVideoSegments(cacheKey);

    if (segments.length === 0) {
      throw new Error('未找到可导出的 IndexedDB 分片');
    }

    return segments.map((segment) => segment.data);
  };

  const handleExport = async () => {
    if (selectedIds.size === 0 || isExporting) return;

    setIsExporting(true);
    try {
      const tasksToExport = completedTasks
        .filter((task) => selectedIds.has(task.id))
        .sort((a, b) => {
          const groupCompare = `${a.source}::${a.videoId}`.localeCompare(
            `${b.source}::${b.videoId}`
          );
          if (groupCompare !== 0) return groupCompare;
          if (a.episodeIndex !== b.episodeIndex)
            return a.episodeIndex - b.episodeIndex;
          return a.completedAt - b.completedAt;
        });

      const unsupportedTasks = tasksToExport.filter(
        (task) => task.downloadMode === 'browser'
      );
      if (unsupportedTasks.length > 0) {
        alert(
          '浏览器下载模式的文件未保存在本地缓存中，无法从下载管理导出。请仅选择 File System API 或 IndexedDB 缓存记录。'
        );
        return;
      }

      let dirHandle: FileSystemDirectoryHandle | undefined;
      if (tasksToExport.some((task) => task.downloadMode === 'filesystem')) {
        dirHandle = await getStoredDownloadDirHandle();
        if (!dirHandle) {
          alert('无法读取下载目录授权，请先在下载设置中重新选择保存目录。');
          return;
        }

        const permission = await dirHandle.requestPermission({
          mode: 'read',
        });
        if (permission !== 'granted') {
          alert('未获得下载目录读取权限，无法导出。');
          return;
        }
      }

      const usedFilenames = new Set<string>();
      let exportedCount = 0;
      const failedTitles: string[] = [];

      for (const task of tasksToExport) {
        try {
          const parts =
            task.downloadMode === 'filesystem'
              ? await readFilesystemTaskAsBlobParts(task, dirHandle!)
              : await readIndexedDBTaskAsBlobParts(task);
          const blob = new Blob(parts, { type: 'video/MP2T' });
          triggerBlobDownload(blob, getTaskExportFilename(task, usedFilenames));
          exportedCount += 1;
        } catch (error) {
          logger.error('导出任务失败:', task.title, error);
          failedTitles.push(`第 ${task.episodeIndex + 1} 集`);
        }
      }

      if (exportedCount === 0) {
        alert(`导出失败：${failedTitles.join('、') || '未找到可导出的内容'}`);
        return;
      }

      if (failedTitles.length > 0) {
        alert(`已导出可读取的内容，但以下条目失败：${failedTitles.join('、')}`);
      }
    } catch (error) {
      logger.error('导出失败:', error);
      alert(
        `导出失败：${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setIsExporting(false);
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '未知';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024)
      return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  const getDownloadModeLabel = (mode: CompletedTask['downloadMode']) => {
    switch (mode) {
      case 'filesystem':
        return 'File System API';
      case 'indexeddb':
        return 'IndexedDB 缓存';
      case 'browser':
      default:
        return '浏览器下载';
    }
  };

  const getGroupTitle = (tasks: CompletedTask[]) => {
    const taskWithVideoTitle = tasks.find((task) => task.videoTitle);
    if (taskWithVideoTitle?.videoTitle) return taskWithVideoTitle.videoTitle;

    const firstTitle = tasks[0]?.title || '未知视频';
    return (
      firstTitle
        .replace(/[_\s-]*第\s*\d+\s*集.*$/u, '')
        .replace(/[_\s-]*EP?\s*\d+.*$/iu, '')
        .trim() || firstTitle
    );
  };

  const videoGroups = useMemo<VideoDownloadGroup[]>(() => {
    const groupMap = new Map<string, CompletedTask[]>();

    for (const task of completedTasks) {
      const key = `${task.source}::${task.videoId}`;
      const groupTasks = groupMap.get(key) || [];
      groupTasks.push(task);
      groupMap.set(key, groupTasks);
    }

    return Array.from(groupMap.entries())
      .map(([key, tasks]) => {
        const sortedTasks = [...tasks].sort((a, b) => {
          if (a.episodeIndex !== b.episodeIndex) {
            return a.episodeIndex - b.episodeIndex;
          }
          return b.completedAt - a.completedAt;
        });
        const totalSize = sortedTasks.reduce(
          (sum, task) => sum + (task.fileSize || 0),
          0
        );
        const modeSet = new Set<CompletedTask['downloadMode']>(
          sortedTasks.map((task) => task.downloadMode)
        );

        return {
          key,
          source: sortedTasks[0].source,
          videoId: sortedTasks[0].videoId,
          title: getGroupTitle(sortedTasks),
          tasks: sortedTasks,
          totalSize: totalSize > 0 ? totalSize : undefined,
          lastCompletedAt: Math.max(
            ...sortedTasks.map((task) => task.completedAt)
          ),
          downloadModes: Array.from(modeSet),
        };
      })
      .sort((a, b) => b.lastCompletedAt - a.lastCompletedAt);
  }, [completedTasks]);

  if (!mounted || !isOpen) return null;

  return (
    <>
      {createPortal(
        <div className='fixed inset-0 z-9999 flex items-end justify-center p-0 sm:items-center sm:p-4'>
          <div className='absolute inset-0 bg-black/50' onClick={onClose} />
          <div className='relative flex h-[92dvh] max-h-[92dvh] w-full max-w-4xl flex-col rounded-t-2xl bg-white shadow-xl dark:bg-gray-900 sm:h-auto sm:max-h-[90vh] sm:rounded-lg'>
            {/* Header */}
            <div className='flex items-center justify-between border-b border-gray-200 p-3 dark:border-gray-700 sm:p-4'>
              <h2 className='text-lg font-semibold text-gray-800 dark:text-gray-200 sm:text-xl'>
                下载文件管理
              </h2>
              <button
                onClick={onClose}
                className='rounded-sm p-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800'
                aria-label='关闭下载文件管理'
              >
                <X className='w-5 h-5 text-gray-600 dark:text-gray-400' />
              </button>
            </div>

            {/* Toolbar */}
            <div className='flex items-center justify-between gap-3 border-b border-gray-200 p-3 dark:border-gray-700 sm:p-4'>
              <div className='min-w-0 flex-1 flex-col gap-2 sm:flex sm:flex-row sm:items-center sm:gap-4'>
                <label className='flex items-center gap-2 cursor-pointer'>
                  <input
                    type='checkbox'
                    checked={
                      selectedIds.size === completedTasks.length &&
                      completedTasks.length > 0
                    }
                    onChange={handleSelectAll}
                    className='w-4 h-4'
                  />
                  <span className='text-sm text-gray-700 dark:text-gray-300'>
                    全选
                  </span>
                </label>
                <span className='text-sm text-gray-500 dark:text-gray-400'>
                  已选择 {selectedIds.size} / {completedTasks.length} 集
                  {videoGroups.length > 0 &&
                    `，共 ${videoGroups.length} 个视频`}
                </span>
              </div>
              <div className='ml-auto flex shrink-0 items-center justify-end gap-2'>
                <button
                  onClick={handleExport}
                  aria-label={isExporting ? '导出中' : '导出选中'}
                  disabled={selectedIds.size === 0 || isExporting || isDeleting}
                  className='flex h-10 w-10 items-center justify-center rounded-sm bg-green-500 text-white transition-colors hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-50 sm:h-auto sm:w-auto sm:gap-2 sm:px-4 sm:py-2 sm:text-sm'
                >
                  <Download className='h-4 w-4' />
                  <span className='hidden sm:inline'>
                    {isExporting ? '导出中...' : '导出选中'}
                  </span>
                </button>
                <button
                  onClick={handleDelete}
                  aria-label={isDeleting ? '删除中' : '删除选中'}
                  disabled={selectedIds.size === 0 || isDeleting || isExporting}
                  className='flex h-10 w-10 items-center justify-center rounded-sm bg-red-500 text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50 sm:h-auto sm:w-auto sm:gap-2 sm:px-4 sm:py-2 sm:text-sm'
                >
                  <Trash2 className='h-4 w-4' />
                  <span className='hidden sm:inline'>
                    {isDeleting ? '删除中...' : '删除选中'}
                  </span>
                </button>
              </div>
            </div>

            {/* Content */}
            <div className='flex-1 overflow-y-auto p-3 sm:p-4'>
              {completedTasks.length === 0 ? (
                <div className='text-center py-12 text-gray-500 dark:text-gray-400'>
                  暂无下载记录
                </div>
              ) : (
                <div className='space-y-3'>
                  {videoGroups.map((group) => {
                    const isExpanded = expandedGroupKeys.has(group.key);
                    const selectedCount = group.tasks.filter((task) =>
                      selectedIds.has(task.id)
                    ).length;
                    const isGroupSelected =
                      selectedCount === group.tasks.length;
                    const isGroupPartiallySelected =
                      selectedCount > 0 && !isGroupSelected;

                    return (
                      <div
                        key={group.key}
                        className={`border rounded-lg overflow-hidden transition-colors ${
                          isGroupSelected || isGroupPartiallySelected
                            ? 'border-green-500 bg-green-50/70 dark:bg-green-900/10'
                            : 'border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        <div
                          className='flex cursor-pointer items-start gap-2 p-3 hover:bg-gray-50 dark:hover:bg-gray-800/80 sm:gap-3 sm:p-4'
                          onClick={() => handleToggleGroupExpand(group.key)}
                        >
                          <button
                            type='button'
                            onClick={(event) => {
                              event.stopPropagation();
                              handleToggleGroupSelect(group);
                            }}
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded border-2 transition-colors sm:mt-1 sm:h-5 sm:w-5 ${
                              isGroupSelected
                                ? 'border-green-500 bg-green-500'
                                : isGroupPartiallySelected
                                ? 'border-green-500 bg-green-100 dark:bg-green-900/40'
                                : 'border-gray-300 dark:border-gray-600'
                            }`}
                            aria-label={`选择 ${group.title}`}
                          >
                            {isGroupSelected ? (
                              <Check className='h-4 w-4 text-white sm:h-3 sm:w-3' />
                            ) : isGroupPartiallySelected ? (
                              <span className='h-0.5 w-3 rounded-sm bg-green-500 sm:w-2.5' />
                            ) : null}
                          </button>

                          <div className='min-w-0 flex-1'>
                            <div className='flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3'>
                              <div className='min-w-0 flex-1'>
                                <h3 className='line-clamp-2 text-sm font-semibold text-gray-800 dark:text-gray-200 sm:truncate'>
                                  {group.title}
                                </h3>
                                <div className='mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-400'>
                                  <span>来源: {group.source}</span>
                                  <span>•</span>
                                  <span>{group.tasks.length} 集</span>
                                  <span>•</span>
                                  <span>
                                    {group.downloadModes
                                      .map(getDownloadModeLabel)
                                      .join(' / ')}
                                  </span>
                                </div>
                              </div>
                              <div className='flex w-full flex-row-reverse items-center justify-between gap-3 text-left sm:w-auto sm:flex-row sm:items-start sm:text-right'>
                                <div className='min-w-0 sm:min-w-[150px]'>
                                  <div className='text-xs text-gray-500 dark:text-gray-400'>
                                    最近完成：
                                    {formatDate(group.lastCompletedAt)}
                                  </div>
                                  <div className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                                    总大小：{formatFileSize(group.totalSize)}
                                  </div>
                                  {selectedCount > 0 && (
                                    <div className='mt-1 text-xs text-green-600 dark:text-green-400'>
                                      已选 {selectedCount} 集
                                    </div>
                                  )}
                                </div>
                                <ChevronDown
                                  className={`h-5 w-5 shrink-0 text-gray-400 transition-transform sm:mt-1 ${
                                    isExpanded ? 'rotate-180' : ''
                                  }`}
                                />
                              </div>
                            </div>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className='border-t border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900'>
                            {group.tasks.map((task) => (
                              <div
                                key={task.id}
                                className={`flex cursor-pointer items-start gap-2 px-3 py-3.5 transition-colors sm:gap-3 sm:px-4 sm:py-3 ${
                                  selectedIds.has(task.id)
                                    ? 'bg-green-50 dark:bg-green-900/20'
                                    : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                                }`}
                                onClick={() => handleToggleSelect(task.id)}
                              >
                                <div className='shrink-0 sm:mt-1'>
                                  <div
                                    className={`flex h-8 w-8 items-center justify-center rounded border-2 sm:h-5 sm:w-5 ${
                                      selectedIds.has(task.id)
                                        ? 'border-green-500 bg-green-500'
                                        : 'border-gray-300 dark:border-gray-600'
                                    }`}
                                  >
                                    {selectedIds.has(task.id) && (
                                      <Check className='h-4 w-4 text-white sm:h-3 sm:w-3' />
                                    )}
                                  </div>
                                </div>
                                <div className='min-w-0 flex-1'>
                                  <div className='flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between'>
                                    <div className='min-w-0 flex-1'>
                                      <h4 className='line-clamp-2 text-sm font-medium text-gray-800 dark:text-gray-200 sm:truncate'>
                                        第 {task.episodeIndex + 1} 集
                                        {task.episodeTitle
                                          ? `：${task.episodeTitle}`
                                          : ''}
                                      </h4>
                                      <p className='mt-1 truncate text-xs text-gray-500 dark:text-gray-400'>
                                        {task.title}
                                      </p>
                                    </div>
                                    <div className='shrink-0 text-left sm:text-right'>
                                      <div className='text-xs text-gray-500 dark:text-gray-400'>
                                        {formatDate(task.completedAt)}
                                      </div>
                                      <div className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                                        {formatFileSize(task.fileSize)}
                                      </div>
                                    </div>
                                  </div>
                                  <div className='mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400'>
                                    <span>第 {task.episodeIndex + 1} 集</span>
                                    <span>•</span>
                                    <span>
                                      {getDownloadModeLabel(task.downloadMode)}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      <ConfirmDialog
        isOpen={showConfirmDialog}
        title='确认删除'
        message={`确定要删除选中的 ${selectedIds.size} 个下载记录吗？\n\n注意：File System API 文件会从磁盘删除，IndexedDB 缓存会从浏览器独立视频缓存库删除。`}
        confirmText='删除'
        cancelText='取消'
        variant='danger'
        onConfirm={handleConfirmDelete}
        onCancel={() => setShowConfirmDialog(false)}
      />
    </>
  );
}
