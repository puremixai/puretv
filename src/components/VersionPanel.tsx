/* eslint-disable no-console */

'use client';

import {
  AlertCircle,
  Bug,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Download,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { changelog, ChangelogEntry } from '@/lib/changelog';
import { PROJECT_NAME, PROJECT_REPOSITORY_URL } from '@/lib/project';
import { CURRENT_VERSION } from '@/lib/version';
import { compareVersions, fetchRemoteChangelog, UpdateStatus } from '@/lib/version_check';

import { createCinemaPortal as createPortal } from '@/components/CinemaPortal';

interface VersionPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

interface RemoteChangelogEntry {
  version: string;
  date: string;
  added: string[];
  changed: string[];
  fixed: string[];
}

export const VersionPanel: React.FC<VersionPanelProps> = ({
  isOpen,
  onClose,
}) => {
  const [mounted, setMounted] = useState(false);
  const [remoteChangelog, setRemoteChangelog] = useState<ChangelogEntry[]>([]);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const hasUpdate = updateStatus === UpdateStatus.HAS_UPDATE;
  const [latestVersion, setLatestVersion] = useState<string>('');
  const [showRemoteContent, setShowRemoteContent] = useState(false);

  // 确保组件已挂载
  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // Body 滚动锁定 - 使用 overflow 方式避免布局问题
  useEffect(() => {
    if (isOpen) {
      const body = document.body;
      const html = document.documentElement;

      // 保存原始样式
      const originalBodyOverflow = body.style.overflow;
      const originalHtmlOverflow = html.style.overflow;

      // 只设置 overflow 来阻止滚动
      body.style.overflow = 'hidden';
      html.style.overflow = 'hidden';

      return () => {
        // 恢复所有原始样式
        body.style.overflow = originalBodyOverflow;
        html.style.overflow = originalHtmlOverflow;
      };
    }
  }, [isOpen]);

  // Ignore responses from a panel that was closed or reopened during the request.
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setUpdateStatus(null);
    setRemoteChangelog([]);
    setLatestVersion('');
    setShowRemoteContent(false);

    fetchRemoteChangelog()
      .then((entries) => {
        if (!active) return;
        setRemoteChangelog(entries);
        setLatestVersion(entries[0].version);
        setUpdateStatus(compareVersions(entries[0].version));
      })
      .catch((error) => {
        if (!active) return;
        console.warn('获取 PureTV 变更日志失败:', error);
        setUpdateStatus(UpdateStatus.FETCH_FAILED);
      });

    return () => { active = false; };
  }, [isOpen]);

  // 渲染变更日志条目
  const renderChangelogEntry = (
    entry: ChangelogEntry | RemoteChangelogEntry,
    isCurrentVersion = false,
    isRemote = false
  ) => {
    const isUpdate = isRemote && hasUpdate && entry.version === latestVersion;

    return (
      <div
        key={entry.version}
        className={`p-4 rounded-lg border ${isCurrentVersion
          ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
          : isUpdate
            ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
            : 'bg-gray-50 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700'
          }`}
      >
        {/* 版本标题 */}
        <div className='flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3'>
          <div className='flex flex-wrap items-center gap-2'>
            <h4 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
              v{entry.version}
            </h4>
            {isCurrentVersion && (
              <span className='px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 rounded-full'>
                当前版本
              </span>
            )}
            {isUpdate && (
              <span className='px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 rounded-full flex items-center gap-1'>
                <Download className='w-3 h-3' />
                可更新
              </span>
            )}
          </div>
          <div className='flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400'>
            {entry.date}
          </div>
        </div>

        {/* 变更内容 */}
        <div className='space-y-3'>
          {entry.added.length > 0 && (
            <div>
              <h5 className='text-sm font-medium text-green-700 dark:text-green-400 mb-2 flex items-center gap-1'>
                <Plus className='w-4 h-4' />
                新增功能
              </h5>
              <ul className='space-y-1'>
                {entry.added.map((item, index) => (
                  <li
                    key={index}
                    className='text-sm text-gray-700 dark:text-gray-300 flex items-start gap-2'
                  >
                    <span className='w-1.5 h-1.5 bg-green-500 rounded-full mt-2 shrink-0'></span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {entry.changed.length > 0 && (
            <div>
              <h5 className='text-sm font-medium text-blue-700 dark:text-blue-400 mb-2 flex items-center gap-1'>
                <RefreshCw className='w-4 h-4' />
                功能改进
              </h5>
              <ul className='space-y-1'>
                {entry.changed.map((item, index) => (
                  <li
                    key={index}
                    className='text-sm text-gray-700 dark:text-gray-300 flex items-start gap-2'
                  >
                    <span className='w-1.5 h-1.5 bg-blue-500 rounded-full mt-2 shrink-0'></span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {entry.fixed.length > 0 && (
            <div>
              <h5 className='text-sm font-medium text-purple-700 dark:text-purple-400 mb-2 flex items-center gap-1'>
                <Bug className='w-4 h-4' />
                问题修复
              </h5>
              <ul className='space-y-1'>
                {entry.fixed.map((item, index) => (
                  <li
                    key={index}
                    className='text-sm text-gray-700 dark:text-gray-300 flex items-start gap-2'
                  >
                    <span className='w-1.5 h-1.5 bg-purple-500 rounded-full mt-2 shrink-0'></span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    );
  };

  // 版本面板内容
  const versionPanelContent = (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-xs z-1000'
        onClick={onClose}
        onTouchMove={(e) => {
          // 只阻止滚动，允许其他触摸事件
          e.preventDefault();
        }}
        onWheel={(e) => {
          // 阻止滚轮滚动
          e.preventDefault();
        }}
        style={{
          touchAction: 'none',
        }}
      />

      {/* 版本面板 */}
      <div
        className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xl max-h-[90vh] bg-white dark:bg-gray-900 rounded-xl shadow-xl z-1001 overflow-hidden'
        onTouchMove={(e) => {
          // 允许版本面板内部滚动，阻止事件冒泡到外层
          e.stopPropagation();
        }}
        style={{
          touchAction: 'auto', // 允许面板内的正常触摸操作
        }}
      >
        {/* 标题栏 */}
        <div className='flex items-center justify-between p-3 sm:p-6 border-b border-gray-200 dark:border-gray-700'>
          <div className='flex items-center gap-2 sm:gap-3'>
            <h3 className='text-lg sm:text-xl font-bold text-gray-800 dark:text-gray-200'>
              {PROJECT_NAME} 版本信息
            </h3>
            <div className='flex flex-wrap items-center gap-1 sm:gap-2'>
              <span className='px-2 sm:px-3 py-1 text-xs sm:text-sm font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 rounded-full'>
                v{CURRENT_VERSION}
              </span>
              {hasUpdate && (
                <span className='px-2 sm:px-3 py-1 text-xs sm:text-sm font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 rounded-full flex items-center gap-1'>
                  <Download className='w-3 h-3 sm:w-4 sm:h-4' />
                  <span className='hidden sm:inline'>有新版本可用</span>
                  <span className='sm:hidden'>可更新</span>
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className='w-6 h-6 sm:w-8 sm:h-8 p-1 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
            aria-label='关闭'
          >
            <X className='w-full h-full' />
          </button>
        </div>

        {/* 内容区域 */}
        <div className='p-3 sm:p-6 overflow-y-auto max-h-[calc(95vh-140px)] sm:max-h-[calc(90vh-120px)]'>
          <div className='space-y-3 sm:space-y-6'>
            {/* 远程更新信息 */}
            {hasUpdate && (
              <div className='bg-linear-to-r from-yellow-50 to-amber-50 dark:from-yellow-900/20 dark:to-amber-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 sm:p-4'>
                <div className='flex flex-col gap-3'>
                  <div className='flex items-center gap-2 sm:gap-3'>
                    <div className='w-8 h-8 sm:w-10 sm:h-10 bg-yellow-100 dark:bg-yellow-800/40 rounded-full flex items-center justify-center shrink-0'>
                      <Download className='w-4 h-4 sm:w-5 sm:h-5 text-yellow-600 dark:text-yellow-400' />
                    </div>
                    <div className='min-w-0 flex-1'>
                      <h4 className='text-sm sm:text-base font-semibold text-yellow-800 dark:text-yellow-200'>
                        发现新版本
                      </h4>
                      <p className='text-xs sm:text-sm text-yellow-700 dark:text-yellow-300 break-all'>
                        v{CURRENT_VERSION} → v{latestVersion}
                      </p>
                    </div>
                  </div>
                  <a
                    href={PROJECT_REPOSITORY_URL}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='inline-flex items-center justify-center gap-2 px-3 py-2 bg-yellow-600 hover:bg-yellow-700 text-white text-xs sm:text-sm rounded-lg transition-colors shadow-xs w-full'
                  >
                    <Download className='w-3 h-3 sm:w-4 sm:h-4' />
                    前往 {PROJECT_NAME} 仓库
                  </a>
                </div>
              </div>
            )}

            {/* Checking, failed, and confirmed results must remain distinct. */}
            {!hasUpdate && (
              <div className='bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4'>
                <div className='flex flex-col gap-3'>
                  <div className='flex items-center gap-2 sm:gap-3'>
                    <div className='w-8 h-8 sm:w-10 sm:h-10 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center shrink-0'>
                      {updateStatus === null ? (
                        <RefreshCw className='w-4 h-4 sm:w-5 sm:h-5 animate-spin text-gray-500' />
                      ) : updateStatus === UpdateStatus.FETCH_FAILED ? (
                        <AlertCircle className='w-4 h-4 sm:w-5 sm:h-5 text-amber-500' />
                      ) : (
                        <CheckCircle className='w-4 h-4 sm:w-5 sm:h-5 text-green-600 dark:text-green-400' />
                      )}
                    </div>
                    <div className='min-w-0 flex-1'>
                      <h4 className='text-sm sm:text-base font-semibold text-gray-800 dark:text-gray-200' aria-live='polite'>
                        {updateStatus === null
                          ? '正在检查 PureTV 更新'
                          : updateStatus === UpdateStatus.FETCH_FAILED
                            ? '暂时无法检查更新'
                            : '未发现新版本'}
                      </h4>
                      <p className='text-xs sm:text-sm text-gray-600 dark:text-gray-300 break-all'>
                        当前安装 {PROJECT_NAME} v{CURRENT_VERSION}
                      </p>
                    </div>
                  </div>
                  <a
                    href={PROJECT_REPOSITORY_URL}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='inline-flex items-center justify-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-xs sm:text-sm rounded-lg transition-colors shadow-xs w-full'
                  >
                    <CheckCircle className='w-3 h-3 sm:w-4 sm:h-4' />
                    前往 {PROJECT_NAME} 仓库
                  </a>
                </div>
              </div>
            )}

            {/* 远程可更新内容 */}
            {hasUpdate && (
              <div className='space-y-4'>
                <div className='flex flex-col sm:flex-row sm:items-center justify-between gap-3'>
                  <h4 className='text-lg font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2'>
                    <Download className='w-5 h-5 text-yellow-500' />
                    远程更新内容
                  </h4>
                  <button
                    onClick={() => setShowRemoteContent(!showRemoteContent)}
                    className='inline-flex items-center justify-center gap-2 px-3 py-1.5 bg-yellow-100 hover:bg-yellow-200 text-yellow-800 dark:bg-yellow-800/30 dark:hover:bg-yellow-800/50 dark:text-yellow-200 rounded-lg transition-colors text-sm w-full sm:w-auto'
                  >
                    {showRemoteContent ? (
                      <>
                        <ChevronUp className='w-4 h-4' />
                        收起
                      </>
                    ) : (
                      <>
                        <ChevronDown className='w-4 h-4' />
                        查看更新内容
                      </>
                    )}
                  </button>
                </div>

                {showRemoteContent && remoteChangelog.length > 0 && (
                  <div className='space-y-4'>
                    {remoteChangelog
                      .filter((entry) => {
                        // 找到第一个本地版本，过滤掉本地已有的版本
                        const localVersions = changelog.map(
                          (local) => local.version
                        );
                        return !localVersions.includes(entry.version);
                      })
                      .map((entry, index) => (
                        <div
                          key={index}
                          className={`p-4 rounded-lg border ${entry.version === latestVersion
                            ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
                            : 'bg-gray-50 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700'
                            }`}
                        >
                          <div className='flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3'>
                            <div className='flex flex-wrap items-center gap-2'>
                              <h4 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                                v{entry.version}
                              </h4>
                              {entry.version === latestVersion && (
                                <span className='px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 rounded-full flex items-center gap-1'>
                                  远程最新
                                </span>
                              )}
                            </div>
                            <div className='flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400'>
                              {entry.date}
                            </div>
                          </div>

                          {entry.added && entry.added.length > 0 && (
                            <div className='mb-3'>
                              <h5 className='text-sm font-medium text-green-600 dark:text-green-400 mb-2 flex items-center gap-1'>
                                <Plus className='w-4 h-4' />
                                新增功能
                              </h5>
                              <ul className='space-y-1'>
                                {entry.added.map((item, itemIndex) => (
                                  <li
                                    key={itemIndex}
                                    className='text-sm text-gray-700 dark:text-gray-300 flex items-start gap-2'
                                  >
                                    <span className='w-1.5 h-1.5 bg-green-400 rounded-full mt-2 shrink-0'></span>
                                    {item}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {entry.changed && entry.changed.length > 0 && (
                            <div className='mb-3'>
                              <h5 className='text-sm font-medium text-blue-600 dark:text-blue-400 mb-2 flex items-center gap-1'>
                                <RefreshCw className='w-4 h-4' />
                                功能改进
                              </h5>
                              <ul className='space-y-1'>
                                {entry.changed.map((item, itemIndex) => (
                                  <li
                                    key={itemIndex}
                                    className='text-sm text-gray-700 dark:text-gray-300 flex items-start gap-2'
                                  >
                                    <span className='w-1.5 h-1.5 bg-blue-400 rounded-full mt-2 shrink-0'></span>
                                    {item}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {entry.fixed && entry.fixed.length > 0 && (
                            <div>
                              <h5 className='text-sm font-medium text-purple-700 dark:text-purple-400 mb-2 flex items-center gap-1'>
                                <Bug className='w-4 h-4' />
                                问题修复
                              </h5>
                              <ul className='space-y-1'>
                                {entry.fixed.map((item, itemIndex) => (
                                  <li
                                    key={itemIndex}
                                    className='text-sm text-gray-700 dark:text-gray-300 flex items-start gap-2'
                                  >
                                    <span className='w-1.5 h-1.5 bg-purple-500 rounded-full mt-2 shrink-0'></span>
                                    {item}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* 变更日志标题 */}
            <div className='border-b border-gray-200 dark:border-gray-700 pb-4'>
              <h4 className='text-lg font-semibold text-gray-800 dark:text-gray-200 pb-3 sm:pb-4'>
                {PROJECT_NAME} 变更日志
              </h4>

              <div className='space-y-4'>
                {/* 本地变更日志 */}
                {changelog.map((entry) =>
                  renderChangelogEntry(
                    entry,
                    entry.version === CURRENT_VERSION,
                    false
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  // 使用 Portal 渲染到 document.body
  if (!mounted || !isOpen) return null;

  return createPortal(versionPanelContent, document.body);
};
