/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { AlertTriangle } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { AdminConfig } from '@/lib/admin.types';
import { adminFetch as fetch } from '@/lib/admin-fetch';

import {
  AlertModal,
  buttonStyles,
  showError,
  useAlertModal,
  useLoadingState,
} from '@/components/admin/shared';

export const WebLiveConfig = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [webLiveSources, setWebLiveSources] = useState<any[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingSource, setEditingSource] = useState<any | null>(null);
  const [newSource, setNewSource] = useState({
    name: '',
    platform: 'huya',
    roomId: '',
  });
  const [showDisclaimerModal, setShowDisclaimerModal] = useState(false);
  const [countdown, setCountdown] = useState(10);
  const [isEnabling, setIsEnabling] = useState(false);

  useEffect(() => {
    if (config?.WebLiveConfig) {
      setWebLiveSources(config.WebLiveConfig);
    }
  }, [config]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (showDisclaimerModal && countdown > 0) {
      timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [showDisclaimerModal, countdown]);

  const callApi = async (body: Record<string, any>) => {
    try {
      const resp = await fetch('/api/admin/web-live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `操作失败: ${resp.status}`);
      }
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失败', showAlert);
      throw err;
    }
  };

  const handleAdd = () => {
    if (!newSource.name || !newSource.platform || !newSource.roomId) return;
    withLoading('addWebLive', async () => {
      await callApi({
        action: 'add',
        name: newSource.name,
        platform: newSource.platform,
        roomId: newSource.roomId,
      });
      setNewSource({ name: '', platform: 'huya', roomId: '' });
      setShowAddForm(false);
    }).catch(() => {});
  };

  const handleEdit = () => {
    if (!editingSource || !editingSource.name || !editingSource.roomId) return;
    withLoading('editWebLive', async () => {
      await callApi({
        action: 'edit',
        key: editingSource.key,
        name: editingSource.name,
        platform: editingSource.platform,
        roomId: editingSource.roomId,
      });
      setEditingSource(null);
    }).catch(() => {});
  };

  const handleToggle = (key: string) => {
    const target = webLiveSources.find((s) => s.key === key);
    if (!target) return;
    const action = target.disabled ? 'enable' : 'disable';
    withLoading(`toggleWebLive_${key}`, () => callApi({ action, key })).catch(
      () => {}
    );
  };

  const handleDelete = (key: string) => {
    withLoading(`deleteWebLive_${key}`, () =>
      callApi({ action: 'delete', key })
    ).catch(() => {});
  };

  const handleToggleWebLiveEnabled = async () => {
    const currentEnabled = config?.WebLiveEnabled ?? false;

    if (!currentEnabled) {
      setShowDisclaimerModal(true);
      setCountdown(10);
    } else {
      await withLoading('toggleWebLiveEnabled', async () => {
        await callApi({ action: 'toggleEnabled', enabled: false });
      }).catch(() => {});
    }
  };

  const handleConfirmEnable = async () => {
    setIsEnabling(true);
    try {
      await callApi({ action: 'toggleEnabled', enabled: true });
      setShowDisclaimerModal(false);
      setCountdown(10);
    } catch {
      // Error already handled by callApi
    } finally {
      setIsEnabling(false);
    }
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* 功能总开关 */}
      <div className='p-4 bg-linear-to-r from-orange-50 to-red-50 dark:from-orange-900/20 dark:to-red-900/20 rounded-lg border-2 border-orange-300 dark:border-orange-700'>
        <div className='flex items-center justify-between'>
          <div className='flex-1'>
            <h4 className='text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1'>
              网络直播功能总开关
            </h4>
            <p className='text-xs text-gray-600 dark:text-gray-400'>
              关闭后，侧边栏和底部导航栏的网络直播入口将被隐藏，用户无法访问网络直播页面
            </p>
          </div>
          <button
            onClick={handleToggleWebLiveEnabled}
            disabled={isLoading('toggleWebLiveEnabled')}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-green-500 ${
              config.WebLiveEnabled
                ? buttonStyles.toggleOn
                : buttonStyles.toggleOff
            } ${
              isLoading('toggleWebLiveEnabled')
                ? 'opacity-50 cursor-not-allowed'
                : ''
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                buttonStyles.toggleThumb
              } ${
                config.WebLiveEnabled
                  ? buttonStyles.toggleThumbOn
                  : buttonStyles.toggleThumbOff
              }`}
            />
          </button>
        </div>
      </div>

      {/* 免责声明弹窗 */}
      {showDisclaimerModal &&
        createPortal(
          <div className='fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4'>
            <div className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full border border-red-200 dark:border-red-800'>
              <div className='p-6'>
                <div className='flex justify-center mb-4'>
                  <AlertTriangle className='w-12 h-12 text-red-500' />
                </div>

                <h3 className='text-xl font-bold text-gray-900 dark:text-gray-100 mb-4 text-center'>
                  免责声明
                </h3>

                <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6'>
                  <p className='text-sm text-gray-700 dark:text-gray-300 leading-relaxed'>
                    本功能仅供个人学习和技术研究使用，请勿将其部署在公网环境中，更不得用于任何违法违规行为。
                    使用本功能所产生的一切法律责任由使用者自行承担，与开发者无关。
                    启用此功能即表示您已充分理解并同意承担相应风险。
                  </p>
                </div>

                <div className='flex gap-3 justify-center'>
                  <button
                    onClick={() => {
                      setShowDisclaimerModal(false);
                      setCountdown(10);
                    }}
                    className={buttonStyles.secondary}
                    disabled={isEnabling}
                  >
                    取消
                  </button>
                  <button
                    onClick={handleConfirmEnable}
                    disabled={countdown > 0 || isEnabling}
                    className={
                      countdown > 0 || isEnabling
                        ? buttonStyles.disabled
                        : buttonStyles.danger
                    }
                  >
                    {isEnabling
                      ? '启用中...'
                      : countdown > 0
                      ? `确认 (${countdown}s)`
                      : '确认启用'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      <div className='flex items-center justify-between'>
        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
          网络直播列表
        </h4>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className={
            showAddForm ? buttonStyles.secondary : buttonStyles.success
          }
        >
          {showAddForm ? '取消' : '添加网络直播'}
        </button>
      </div>

      {showAddForm && (
        <div className='p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 space-y-4'>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
            <input
              type='text'
              placeholder='名称'
              value={newSource.name}
              onChange={(e) =>
                setNewSource((prev) => ({ ...prev, name: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <select
              value={newSource.platform}
              onChange={(e) =>
                setNewSource((prev) => ({ ...prev, platform: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            >
              <option value='huya'>虎牙</option>
              <option value='bilibili'>哔哩哔哩</option>
              <option value='douyin'>抖音</option>
            </select>
            <input
              type='text'
              placeholder='房间ID'
              value={newSource.roomId}
              onChange={(e) =>
                setNewSource((prev) => ({ ...prev, roomId: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
          </div>
          <div className='flex justify-end'>
            <button
              onClick={handleAdd}
              disabled={
                !newSource.name ||
                !newSource.platform ||
                !newSource.roomId ||
                isLoading('addWebLive')
              }
              className={`w-full sm:w-auto px-4 py-2 ${
                !newSource.name ||
                !newSource.platform ||
                !newSource.roomId ||
                isLoading('addWebLive')
                  ? buttonStyles.disabled
                  : buttonStyles.success
              }`}
            >
              {isLoading('addWebLive') ? '添加中...' : '添加'}
            </button>
          </div>
        </div>
      )}

      {editingSource && (
        <div className='p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 space-y-4'>
          <div className='flex items-center justify-between'>
            <h5 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
              编辑: {editingSource.name}
            </h5>
            <button
              onClick={() => setEditingSource(null)}
              className='text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
            >
              ✕
            </button>
          </div>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
            <div>
              <label className='block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1'>
                名称
              </label>
              <input
                type='text'
                value={editingSource.name}
                onChange={(e) =>
                  setEditingSource((prev: any) =>
                    prev ? { ...prev, name: e.target.value } : null
                  )
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
              />
            </div>
            <div>
              <label className='block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1'>
                直播类型
              </label>
              <select
                value={editingSource.platform}
                onChange={(e) =>
                  setEditingSource((prev: any) =>
                    prev ? { ...prev, platform: e.target.value } : null
                  )
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
              >
                <option value='huya'>虎牙</option>
                <option value='bilibili'>哔哩哔哩</option>
                <option value='douyin'>抖音</option>
              </select>
            </div>
            <div>
              <label className='block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1'>
                房间ID
              </label>
              <input
                type='text'
                value={editingSource.roomId}
                onChange={(e) =>
                  setEditingSource((prev: any) =>
                    prev ? { ...prev, roomId: e.target.value } : null
                  )
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
              />
            </div>
          </div>
          <div className='flex justify-end space-x-2'>
            <button
              onClick={() => setEditingSource(null)}
              className={buttonStyles.secondary}
            >
              取消
            </button>
            <button
              onClick={handleEdit}
              disabled={
                !editingSource.name ||
                !editingSource.roomId ||
                isLoading('editWebLive')
              }
              className={`${
                !editingSource.name ||
                !editingSource.roomId ||
                isLoading('editWebLive')
                  ? buttonStyles.disabled
                  : buttonStyles.success
              }`}
            >
              {isLoading('editWebLive') ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      )}

      <div className='border border-gray-200 dark:border-gray-700 rounded-lg overflow-auto'>
        <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
          <thead className='bg-gray-50 dark:bg-gray-900'>
            <tr>
              <th className='px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase'>
                名称
              </th>
              <th className='hidden sm:table-cell px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase'>
                直播类型
              </th>
              <th className='hidden sm:table-cell px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase'>
                房间ID
              </th>
              <th className='px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase'>
                状态
              </th>
              <th className='px-3 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase'>
                操作
              </th>
            </tr>
          </thead>
          <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
            {webLiveSources.map((source) => (
              <tr
                key={source.key}
                className='hover:bg-gray-50 dark:hover:bg-gray-800'
              >
                <td className='px-3 sm:px-6 py-4 text-sm text-gray-900 dark:text-gray-100'>
                  <div>{source.name}</div>
                  <div className='sm:hidden text-xs text-gray-500 dark:text-gray-400 mt-1'>
                    {source.platform === 'huya'
                      ? '虎牙'
                      : source.platform === 'bilibili'
                      ? '哔哩哔哩'
                      : source.platform === 'douyin'
                      ? '抖音'
                      : source.platform}{' '}
                    · {source.roomId}
                  </div>
                </td>
                <td className='hidden sm:table-cell px-6 py-4 text-sm text-gray-900 dark:text-gray-100'>
                  {source.platform === 'huya'
                    ? '虎牙'
                    : source.platform === 'bilibili'
                    ? '哔哩哔哩'
                    : source.platform === 'douyin'
                    ? '抖音'
                    : source.platform}
                </td>
                <td className='hidden sm:table-cell px-6 py-4 text-sm text-gray-900 dark:text-gray-100'>
                  {source.roomId}
                </td>
                <td className='px-3 sm:px-6 py-4 whitespace-nowrap'>
                  <span
                    className={`px-2 py-1 text-xs rounded-full whitespace-nowrap ${
                      !source.disabled
                        ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                        : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
                    }`}
                  >
                    {!source.disabled ? '启用中' : '已禁用'}
                  </span>
                </td>
                <td className='px-3 sm:px-6 py-4 text-right text-sm whitespace-nowrap'>
                  <div className='flex flex-col sm:flex-row gap-1 sm:gap-2 items-end sm:items-center justify-end'>
                    <button
                      onClick={() => handleToggle(source.key)}
                      disabled={isLoading(`toggleWebLive_${source.key}`)}
                      className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium ${
                        !source.disabled
                          ? buttonStyles.roundedDanger
                          : buttonStyles.roundedSuccess
                      } ${
                        isLoading(`toggleWebLive_${source.key}`)
                          ? 'opacity-50 cursor-not-allowed'
                          : ''
                      }`}
                    >
                      {!source.disabled ? '禁用' : '启用'}
                    </button>
                    {source.from !== 'config' && (
                      <>
                        <button
                          onClick={() => setEditingSource(source)}
                          disabled={isLoading(`editWebLive_${source.key}`)}
                          className={`${buttonStyles.roundedPrimary} ${
                            isLoading(`editWebLive_${source.key}`)
                              ? 'opacity-50 cursor-not-allowed'
                              : ''
                          }`}
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => handleDelete(source.key)}
                          disabled={isLoading(`deleteWebLive_${source.key}`)}
                          className={`${buttonStyles.roundedSecondary} ${
                            isLoading(`deleteWebLive_${source.key}`)
                              ? 'opacity-50 cursor-not-allowed'
                              : ''
                          }`}
                        >
                          删除
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
      />
    </div>
  );
};
