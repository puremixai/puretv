/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

'use client';
import {
  closestCenter,
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from '@dnd-kit/modifiers';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { useEffect, useState } from 'react';

import { AdminConfig } from '@/lib/admin.types';
import { adminFetch as fetch } from '@/lib/admin-fetch';
import { resolveLiveProxyMode } from '@/lib/live-playback';

import {
  AlertModal,
  buttonStyles,
  showError,
  useAlertModal,
  useLoadingState,
} from '@/components/admin/shared';

import { LiveDataSource } from './types';

const liveProxyModes = [
  { value: 'direct', label: '直连（默认）' },
  { value: 'm3u8-only', label: '仅代理m3u8' },
  { value: 'full', label: '全量代理' },
] as const;

export const LiveSourceConfig = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [liveSources, setLiveSources] = useState<LiveDataSource[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingLiveSource, setEditingLiveSource] =
    useState<LiveDataSource | null>(null);
  const [orderChanged, setOrderChanged] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshIntervalHours, setRefreshIntervalHours] = useState(12);
  const [newLiveSource, setNewLiveSource] = useState<LiveDataSource>({
    name: '',
    key: '',
    url: '',
    ua: '',
    epg: '',
    disabled: false,
    from: 'custom',
    proxyMode: 'direct',
  });

  // dnd-kit 传感器
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 轻微位移即可触发
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150, // 长按 150ms 后触发，避免与滚动冲突
        tolerance: 5,
      },
    }),
  );

  // 初始化
  useEffect(() => {
    if (config?.LiveConfig) {
      setLiveSources(config.LiveConfig);
      setRefreshIntervalHours(config.LiveRefreshIntervalHours || 12);
      // 进入时重置 orderChanged
      setOrderChanged(false);
    }
  }, [config]);

  // 通用 API 请求
  const callLiveSourceApi = async (body: Record<string, any>) => {
    try {
      const resp = await fetch('/api/admin/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `操作失败: ${resp.status}`);
      }

      // 成功后刷新配置
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失败', showAlert);
      throw err; // 向上抛出方便调用处判断
    }
  };

  const handleToggleEnable = (key: string) => {
    const target = liveSources.find((s) => s.key === key);
    if (!target) return;
    const action = target.disabled ? 'enable' : 'disable';
    withLoading(`toggleLiveSource_${key}`, () =>
      callLiveSourceApi({ action, key }),
    ).catch(() => {
      console.error('操作失败', action, key);
    });
  };

  const handleSetProxyMode = (
    key: string,
    mode: 'full' | 'm3u8-only' | 'direct',
  ) => {
    withLoading(`setLiveProxyMode_${key}`, async () => {
      // 保存旧值用于回滚
      const oldMode = liveSources.find((s) => s.key === key)?.proxyMode;

      // 乐观更新本地状态
      setLiveSources((prev) =>
        prev.map((s) => (s.key === key ? { ...s, proxyMode: mode } : s)),
      );

      try {
        const response = await fetch('/api/admin/live', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'set_proxy_mode',
            key,
            proxyMode: mode,
          }),
        });

        if (!response.ok) {
          throw new Error('设置代理模式失败');
        }

        // 成功后刷新配置
        await refreshConfig();
      } catch (error) {
        // 失败时回滚本地状态
        setLiveSources((prev) =>
          prev.map((s) => (s.key === key ? { ...s, proxyMode: oldMode } : s)),
        );
        showError(
          error instanceof Error ? error.message : '设置代理模式失败',
          showAlert,
        );
        throw error;
      }
    }).catch(() => {
      console.error('操作失败', 'set_proxy_mode', key);
    });
  };

  const handleDelete = (key: string) => {
    withLoading(`deleteLiveSource_${key}`, () =>
      callLiveSourceApi({ action: 'delete', key }),
    ).catch(() => {
      console.error('操作失败', 'delete', key);
    });
  };

  // 刷新直播源
  const handleSaveRefreshInterval = () => {
    withLoading('saveLiveRefreshInterval', async () => {
      if (!config) return;

      const response = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          LiveRefreshIntervalHours: Math.max(1, refreshIntervalHours || 12),
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `保存失败: ${response.status}`);
      }

      await refreshConfig();
      showAlert({
        type: 'success',
        title: '保存成功',
        message: '电视直播刷新间隔已保存',
        timer: 2000,
      });
    }).catch((err) => {
      showError(err instanceof Error ? err.message : '保存失败', showAlert);
    });
  };

  const handleRefreshLiveSources = async () => {
    if (isRefreshing) return;

    await withLoading('refreshLiveSources', async () => {
      setIsRefreshing(true);
      try {
        const response = await fetch('/api/admin/live/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `刷新失败: ${response.status}`);
        }

        // 刷新成功后重新获取配置
        await refreshConfig();
        showAlert({
          type: 'success',
          title: '刷新成功',
          message: '直播源已刷新',
          timer: 2000,
        });
      } catch (err) {
        showError(err instanceof Error ? err.message : '刷新失败', showAlert);
        throw err;
      } finally {
        setIsRefreshing(false);
      }
    });
  };

  const handleAddLiveSource = () => {
    if (!newLiveSource.name || !newLiveSource.key || !newLiveSource.url) return;
    withLoading('addLiveSource', async () => {
      await callLiveSourceApi({
        action: 'add',
        key: newLiveSource.key,
        name: newLiveSource.name,
        url: newLiveSource.url,
        ua: newLiveSource.ua,
        epg: newLiveSource.epg,
        proxyMode: resolveLiveProxyMode(newLiveSource.proxyMode),
      });
      setNewLiveSource({
        name: '',
        key: '',
        url: '',
        epg: '',
        ua: '',
        disabled: false,
        from: 'custom',
        proxyMode: 'direct',
      });
      setShowAddForm(false);
    }).catch(() => {
      console.error('操作失败', 'add', newLiveSource);
    });
  };

  const handleEditLiveSource = () => {
    if (!editingLiveSource || !editingLiveSource.name || !editingLiveSource.url)
      return;
    withLoading('editLiveSource', async () => {
      await callLiveSourceApi({
        action: 'edit',
        key: editingLiveSource.key,
        name: editingLiveSource.name,
        url: editingLiveSource.url,
        ua: editingLiveSource.ua,
        epg: editingLiveSource.epg,
      });
      setEditingLiveSource(null);
    }).catch(() => {
      console.error('操作失败', 'edit', editingLiveSource);
    });
  };

  const handleCancelEdit = () => {
    setEditingLiveSource(null);
  };

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = liveSources.findIndex((s) => s.key === active.id);
    const newIndex = liveSources.findIndex((s) => s.key === over.id);
    setLiveSources((prev) => arrayMove(prev, oldIndex, newIndex));
    setOrderChanged(true);
  };

  const handleSaveOrder = () => {
    const order = liveSources.map((s) => s.key);
    withLoading('saveLiveSourceOrder', () =>
      callLiveSourceApi({ action: 'sort', order }),
    )
      .then(() => {
        setOrderChanged(false);
      })
      .catch(() => {
        console.error('操作失败', 'sort', order);
      });
  };

  // 可拖拽行封装 (dnd-kit)
  const DraggableRow = ({ liveSource }: { liveSource: LiveDataSource }) => {
    const { attributes, listeners, setNodeRef, transform, transition } =
      useSortable({ id: liveSource.key });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
    } as React.CSSProperties;

    return (
      <tr
        ref={setNodeRef}
        style={style}
        className='hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors select-none'
      >
        <td
          className='px-2 py-4 cursor-grab text-gray-400'
          style={{ touchAction: 'none' }}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} />
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
          {liveSource.name}
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
          {liveSource.key}
        </td>
        <td
          className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 max-w-48 truncate'
          title={liveSource.url}
        >
          {liveSource.url}
        </td>
        <td
          className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 max-w-32 truncate'
          title={liveSource.epg || '-'}
        >
          {liveSource.epg || '-'}
        </td>
        <td
          className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 max-w-32 truncate'
          title={liveSource.ua || '-'}
        >
          {liveSource.ua || '-'}
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 text-center'>
          {liveSource.channelNumber && liveSource.channelNumber > 0
            ? liveSource.channelNumber
            : '-'}
        </td>
        <td className='px-6 py-4 whitespace-nowrap max-w-4'>
          <span
            className={`rounded-full px-2 py-1 text-xs ${
              !liveSource.disabled
                ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
            }`}
          >
            {!liveSource.disabled ? '启用中' : '已禁用'}
          </span>
        </td>
        <td className='px-6 py-4 whitespace-nowrap'>
          <select
            aria-label={`${liveSource.name}代理模式`}
            value={resolveLiveProxyMode(liveSource.proxyMode)}
            onChange={(e) => {
              handleSetProxyMode(
                liveSource.key,
                resolveLiveProxyMode(e.target.value),
              );
            }}
            disabled={isLoading(`setLiveProxyMode_${liveSource.key}`)}
            className={`rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 ${
              isLoading(`setLiveProxyMode_${liveSource.key}`)
                ? 'opacity-50 cursor-not-allowed'
                : 'cursor-pointer'
            }`}
          >
            {liveProxyModes.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2'>
          <button
            onClick={() => handleToggleEnable(liveSource.key)}
            disabled={isLoading(`toggleLiveSource_${liveSource.key}`)}
            className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium ${
              !liveSource.disabled
                ? buttonStyles.roundedDanger
                : buttonStyles.roundedSuccess
            } transition-colors ${
              isLoading(`toggleLiveSource_${liveSource.key}`)
                ? 'opacity-50 cursor-not-allowed'
                : ''
            }`}
          >
            {!liveSource.disabled ? '禁用' : '启用'}
          </button>
          {liveSource.from !== 'config' && (
            <>
              <button
                onClick={() => setEditingLiveSource(liveSource)}
                disabled={isLoading(`editLiveSource_${liveSource.key}`)}
                className={`${buttonStyles.roundedPrimary} ${
                  isLoading(`editLiveSource_${liveSource.key}`)
                    ? 'opacity-50 cursor-not-allowed'
                    : ''
                }`}
              >
                编辑
              </button>
              <button
                onClick={() => handleDelete(liveSource.key)}
                disabled={isLoading(`deleteLiveSource_${liveSource.key}`)}
                className={`${buttonStyles.roundedSecondary} ${
                  isLoading(`deleteLiveSource_${liveSource.key}`)
                    ? 'opacity-50 cursor-not-allowed'
                    : ''
                }`}
              >
                删除
              </button>
            </>
          )}
        </td>
      </tr>
    );
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
      {/* 添加直播源表单 */}
      <div className='space-y-4'>
        <div className='flex items-end justify-between gap-3'>
          <div className='flex items-end gap-2 flex-nowrap'>
            <div className='min-w-0'>
              <label className='block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1 whitespace-nowrap'>
                刷新间隔（小时）
              </label>
              <input
                type='number'
                min='1'
                value={refreshIntervalHours}
                onChange={(e) =>
                  setRefreshIntervalHours(
                    Math.max(1, parseInt(e.target.value) || 12),
                  )
                }
                className='px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 w-28 sm:w-40'
              />
            </div>
            <button
              onClick={handleSaveRefreshInterval}
              disabled={isLoading('saveLiveRefreshInterval')}
              className={`shrink-0 px-3 py-1.5 text-sm whitespace-nowrap ${
                isLoading('saveLiveRefreshInterval')
                  ? buttonStyles.disabled
                  : buttonStyles.success
              }`}
            >
              {isLoading('saveLiveRefreshInterval') ? '保存中...' : '保存间隔'}
            </button>
          </div>
        </div>
        <div className='flex items-center justify-between'>
          <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
            直播源列表
          </h4>
          <div className='flex items-center space-x-2'>
            <button
              onClick={handleRefreshLiveSources}
              disabled={isRefreshing || isLoading('refreshLiveSources')}
              className={`flex items-center space-x-2 px-3 py-1.5 text-sm font-medium ${
                isRefreshing || isLoading('refreshLiveSources')
                  ? 'bg-gray-400 dark:bg-gray-600 cursor-not-allowed text-white rounded-lg'
                  : 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-lg transition-colors'
              }`}
            >
              <span>
                {isRefreshing || isLoading('refreshLiveSources')
                  ? '刷新中...'
                  : '刷新直播源'}
              </span>
            </button>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className={`${
                showAddForm ? buttonStyles.secondary : buttonStyles.success
              } shrink-0 whitespace-nowrap`}
            >
              {showAddForm ? '取消' : '添加直播源'}
            </button>
          </div>
        </div>
        <p className='text-xs text-gray-500 dark:text-gray-400'>
          直连由播放器直接请求直播地址，服务器不转发视频；仅在播放受限时按需配置代理。
        </p>
      </div>

      {showAddForm && (
        <div className='p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 space-y-4'>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
            <input
              type='text'
              placeholder='名称'
              value={newLiveSource.name}
              onChange={(e) =>
                setNewLiveSource((prev) => ({ ...prev, name: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='Key'
              value={newLiveSource.key}
              onChange={(e) =>
                setNewLiveSource((prev) => ({ ...prev, key: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='M3U 地址'
              value={newLiveSource.url}
              onChange={(e) =>
                setNewLiveSource((prev) => ({ ...prev, url: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='节目单地址（选填）'
              value={newLiveSource.epg}
              onChange={(e) =>
                setNewLiveSource((prev) => ({ ...prev, epg: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='自定义 UA（选填）'
              value={newLiveSource.ua}
              onChange={(e) =>
                setNewLiveSource((prev) => ({ ...prev, ua: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <label className='flex items-center gap-3 text-sm text-gray-700 dark:text-gray-300'>
              代理模式
              <select
                aria-label='新直播源代理模式'
                value={resolveLiveProxyMode(newLiveSource.proxyMode)}
                onChange={(e) =>
                  setNewLiveSource((prev) => ({
                    ...prev,
                    proxyMode: resolveLiveProxyMode(e.target.value),
                  }))
                }
                className='flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
              >
                {liveProxyModes.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className='flex justify-end'>
            <button
              onClick={handleAddLiveSource}
              disabled={
                !newLiveSource.name ||
                !newLiveSource.key ||
                !newLiveSource.url ||
                isLoading('addLiveSource')
              }
              className={`w-full px-4 py-2 sm:w-auto ${
                !newLiveSource.name ||
                !newLiveSource.key ||
                !newLiveSource.url ||
                isLoading('addLiveSource')
                  ? buttonStyles.disabled
                  : buttonStyles.success
              }`}
            >
              {isLoading('addLiveSource') ? '添加中...' : '添加'}
            </button>
          </div>
        </div>
      )}

      {/* 编辑直播源表单 */}
      {editingLiveSource && (
        <div className='p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 space-y-4'>
          <div className='flex items-center justify-between'>
            <h5 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
              编辑直播源: {editingLiveSource.name}
            </h5>
            <button
              onClick={handleCancelEdit}
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
                value={editingLiveSource.name}
                onChange={(e) =>
                  setEditingLiveSource((prev) =>
                    prev ? { ...prev, name: e.target.value } : null,
                  )
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
              />
            </div>
            <div>
              <label className='block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1'>
                Key (不可编辑)
              </label>
              <input
                type='text'
                value={editingLiveSource.key}
                disabled
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed'
              />
            </div>
            <div>
              <label className='block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1'>
                M3U 地址
              </label>
              <input
                type='text'
                value={editingLiveSource.url}
                onChange={(e) =>
                  setEditingLiveSource((prev) =>
                    prev ? { ...prev, url: e.target.value } : null,
                  )
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
              />
            </div>
            <div>
              <label className='block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1'>
                节目单地址（选填）
              </label>
              <input
                type='text'
                value={editingLiveSource.epg}
                onChange={(e) =>
                  setEditingLiveSource((prev) =>
                    prev ? { ...prev, epg: e.target.value } : null,
                  )
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
              />
            </div>
            <div>
              <label className='block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1'>
                自定义 UA（选填）
              </label>
              <input
                type='text'
                value={editingLiveSource.ua}
                onChange={(e) =>
                  setEditingLiveSource((prev) =>
                    prev ? { ...prev, ua: e.target.value } : null,
                  )
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
              />
            </div>
          </div>
          <div className='flex justify-end space-x-2'>
            <button
              onClick={handleCancelEdit}
              className={buttonStyles.secondary}
            >
              取消
            </button>
            <button
              onClick={handleEditLiveSource}
              disabled={
                !editingLiveSource.name ||
                !editingLiveSource.url ||
                isLoading('editLiveSource')
              }
              className={`${
                !editingLiveSource.name ||
                !editingLiveSource.url ||
                isLoading('editLiveSource')
                  ? buttonStyles.disabled
                  : buttonStyles.success
              }`}
            >
              {isLoading('editLiveSource') ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      )}

      {/* 直播源表格 */}
      <div
        className='border border-gray-200 dark:border-gray-700 rounded-lg max-h-112 overflow-y-auto overflow-x-auto relative'
        data-table='live-source-list'
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          autoScroll={false}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        >
          <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
            <thead className='bg-gray-50 dark:bg-gray-900 sticky top-0 z-10'>
              <tr>
                <th
                  className='px-2 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                  aria-label='排序'
                />
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  名称
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  Key
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  M3U 地址
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  节目单地址
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  自定义 UA
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  频道数
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  状态
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  代理模式
                </th>
                <th className='px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  操作
                </th>
              </tr>
            </thead>
            <SortableContext
              items={liveSources.map((s) => s.key)}
              strategy={verticalListSortingStrategy}
            >
              <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                {liveSources.map((liveSource) => (
                  <DraggableRow key={liveSource.key} liveSource={liveSource} />
                ))}
              </tbody>
            </SortableContext>
          </table>
        </DndContext>
      </div>

      {/* 保存排序按钮 */}
      {orderChanged && (
        <div className='flex justify-end'>
          <button
            onClick={handleSaveOrder}
            disabled={isLoading('saveLiveSourceOrder')}
            className={`px-3 py-1.5 text-sm ${
              isLoading('saveLiveSourceOrder')
                ? buttonStyles.disabled
                : buttonStyles.primary
            }`}
          >
            {isLoading('saveLiveSourceOrder') ? '保存中...' : '保存排序'}
          </button>
        </div>
      )}

      {/* 通用弹窗组件 */}
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
