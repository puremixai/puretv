/* eslint-disable @typescript-eslint/no-explicit-any, no-console,react-hooks/exhaustive-deps */

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
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
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

import { filterVideoSources, SourceListStatus } from './source-list';
import { SourceHealthPanel } from './SourceHealthPanel';
import { DataSource } from './types';

export const VideoSourceConfig = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [sources, setSources] = useState<DataSource[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [, setOrderChanged] = useState(false);
  const [newSource, setNewSource] = useState<DataSource>({
    name: '',
    key: '',
    api: '',
    detail: '',
    disabled: false,
    from: 'config',
  });

  const [sourceQuery, setSourceQuery] = useState('');
  const [sourceStatus, setSourceStatus] = useState<SourceListStatus>('all');
  const visibleSources = useMemo(
    () => filterVideoSources(sources, sourceQuery, sourceStatus),
    [sources, sourceQuery, sourceStatus]
  );
  // 批量操作相关状态
  const [selectedSources, setSelectedSources] = useState<Set<string>>(
    new Set()
  );

  // 使用 useMemo 计算全选状态，避免每次渲染都重新计算
  const selectAll = useMemo(() => {
    return (
      visibleSources.length > 0 &&
      visibleSources.every((source) => selectedSources.has(source.key))
    );
  }, [selectedSources, visibleSources]);

  // 确认弹窗状态
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    onCancel: () => {},
  });

  // 搜索与播放检测相关状态
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [showWeightModal, setShowWeightModal] = useState(false);
  const [showSpecialSourcesModal, setShowSpecialSourcesModal] = useState(false);
  const [showClientAdSourcesModal, setShowClientAdSourcesModal] =
    useState(false);
  const [specialSourceDraftApis, setSpecialSourceDraftApis] = useState<
    string[]
  >([]);
  const [clientAdSourceDraftApis, setClientAdSourceDraftApis] = useState<
    string[]
  >([]);
  const [weightDraftSources, setWeightDraftSources] = useState<DataSource[]>(
    []
  );
  const [searchKeyword, setSearchKeyword] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [healthEpoch, setHealthEpoch] = useState(0);
  const [validationResults, setValidationResults] = useState<
    Array<{
      key: string;
      name: string;
      status: 'valid' | 'no_results' | 'invalid' | 'validating';
      message: string;
      resultCount: number;
    }>
  >([]);

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
    })
  );

  // 初始化
  useEffect(() => {
    if (config?.SourceConfig) {
      setSources(config.SourceConfig);
      // 进入时重置 orderChanged
      setOrderChanged(false);
      // 重置选择状态
      setSelectedSources(new Set());
    }
  }, [config]);

  // 通用 API 请求
  const callSourceApi = async (body: Record<string, any>) => {
    try {
      const resp = await fetch('/api/admin/source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `操作失败: ${resp.status}`);
      }

      // 获取响应数据
      const data = await resp.json();

      // 成功后刷新配置
      await refreshConfig();

      // 返回响应数据供调用者使用
      return data;
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失败', showAlert);
      throw err; // 向上抛出方便调用处判断
    }
  };

  const handleToggleEnable = (key: string) => {
    const target = sources.find((s) => s.key === key);
    if (!target) return;
    const action = target.disabled ? 'enable' : 'disable';
    withLoading(`toggleSource_${key}`, () =>
      callSourceApi({ action, key })
    ).catch(() => {
      console.error('操作失败', action, key);
    });
  };

  const handleDelete = (key: string) => {
    withLoading(`deleteSource_${key}`, () =>
      callSourceApi({ action: 'delete', key })
    ).catch(() => {
      console.error('操作失败', 'delete', key);
    });
  };

  const handleToggleProxyMode = (key: string) => {
    const target = sources.find((s) => s.key === key);
    if (!target) return;

    // 更新本地状态
    setSources((prev) =>
      prev.map((s) => (s.key === key ? { ...s, proxyMode: !s.proxyMode } : s))
    );

    // 调用API更新
    withLoading(`toggleProxyMode_${key}`, async () => {
      try {
        const response = await fetch('/api/admin/source', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'toggle_proxy_mode',
            key,
          }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `操作失败: ${response.status}`);
        }

        await refreshConfig();
      } catch (error) {
        // 失败时回滚本地状态
        setSources((prev) =>
          prev.map((s) =>
            s.key === key ? { ...s, proxyMode: !s.proxyMode } : s
          )
        );
        showError(
          error instanceof Error ? error.message : '切换代理模式失败',
          showAlert
        );
        throw error;
      }
    }).catch(() => {
      console.error('操作失败', 'toggle_proxy_mode', key);
    });
  };

  const openSpecialSourcesModal = () => {
    setSpecialSourceDraftApis(config?.SpecialSourceApis || []);
    setShowSpecialSourcesModal(true);
  };

  const closeSpecialSourcesModal = () => {
    setShowSpecialSourcesModal(false);
    setSpecialSourceDraftApis([]);
  };

  const doSaveSpecialSources = async () => {
    await withLoading('saveSpecialSources', async () => {
      await callSourceApi({
        action: 'set_special_sources',
        keys: specialSourceDraftApis,
      });
      closeSpecialSourcesModal();
    }).catch(() => {
      console.error('操作失败', 'set_special_sources');
    });
  };

  const openClientAdSourcesModal = () => {
    setClientAdSourceDraftApis(config?.ClientAdSourceApis || []);
    setShowClientAdSourcesModal(true);
  };

  const closeClientAdSourcesModal = () => {
    setShowClientAdSourcesModal(false);
    setClientAdSourceDraftApis([]);
  };

  const handleSaveClientAdSources = async () => {
    await withLoading('saveClientAdSources', async () => {
      await callSourceApi({
        action: 'set_client_ad_sources',
        keys: clientAdSourceDraftApis,
      });
      closeClientAdSourcesModal();
    }).catch(() => {
      console.error('操作失败', 'set_client_ad_sources');
    });
  };

  const handleSaveSpecialSources = async () => {
    const enabledSourceKeys =
      config?.SourceConfig?.filter((source) => !source.disabled).map(
        (source) => source.key
      ) || [];
    const selectedSet = new Set(specialSourceDraftApis);
    const selectedAllEnabledSources =
      enabledSourceKeys.length > 0 &&
      enabledSourceKeys.every((key) => selectedSet.has(key));

    if (selectedAllEnabledSources) {
      setConfirmModal({
        isOpen: true,
        title: '确认设置特殊源',
        message:
          '你已将全部启用的视频源设置为特殊源，未开启特殊源开关的用户可能无法使用搜索。确定要继续保存吗？',
        onConfirm: async () => {
          await doSaveSpecialSources();
          setConfirmModal({
            isOpen: false,
            title: '',
            message: '',
            onConfirm: () => {},
            onCancel: () => {},
          });
        },
        onCancel: () => {
          setConfirmModal({
            isOpen: false,
            title: '',
            message: '',
            onConfirm: () => {},
            onCancel: () => {},
          });
        },
      });
      return;
    }

    await doSaveSpecialSources();
  };

  const handleAddSource = () => {
    if (!newSource.name || !newSource.key || !newSource.api) return;
    withLoading('addSource', async () => {
      await callSourceApi({
        action: 'add',
        key: newSource.key,
        name: newSource.name,
        api: newSource.api,
        detail: newSource.detail,
      });
      setNewSource({
        name: '',
        key: '',
        api: '',
        detail: '',
        disabled: false,
        from: 'custom',
      });
      setShowAddForm(false);
    }).catch(() => {
      console.error('操作失败', 'add', newSource);
    });
  };

  const buildRecommendedWeightMap = useCallback((list: DataSource[]) => {
    const total = list.length;
    return new Map(
      list.map((source, index) => {
        const recommended =
          total <= 1
            ? 40
            : Math.round(((total - index - 1) * 40) / (total - 1));
        return [source.key, recommended];
      })
    );
  }, []);

  const applyRecommendedWeights = useCallback((list: DataSource[]) => {
    const total = list.length;
    return list.map((source, index) => ({
      ...source,
      weight:
        total <= 1 ? 40 : Math.round(((total - index - 1) * 40) / (total - 1)),
    }));
  }, []);

  const openWeightModal = useCallback(() => {
    setWeightDraftSources(sources.map((source) => ({ ...source })));
    setShowWeightModal(true);
  }, [sources]);

  const handleCloseWeightModal = useCallback(() => {
    setShowWeightModal(false);
    setWeightDraftSources([]);
  }, []);

  useEffect(() => {
    if (!showWeightModal) return;

    const isInsideAllowedScroll = (target: EventTarget | null) => {
      if (!(target instanceof Node)) return false;
      return !!target.parentElement?.closest('[data-weight-modal-scroll]');
    };

    const preventBackgroundScroll = (event: TouchEvent | WheelEvent) => {
      if (isInsideAllowedScroll(event.target)) return;
      event.preventDefault();
    };

    document.addEventListener('touchmove', preventBackgroundScroll, {
      passive: false,
    });
    document.addEventListener('wheel', preventBackgroundScroll, {
      passive: false,
    });

    return () => {
      document.removeEventListener(
        'touchmove',
        preventBackgroundScroll as EventListener
      );
      document.removeEventListener(
        'wheel',
        preventBackgroundScroll as EventListener
      );
    };
  }, [showWeightModal]);

  const handleWeightDraftChange = useCallback((key: string, weight: number) => {
    setWeightDraftSources((prev) =>
      prev.map((source) =>
        source.key === key ? { ...source, weight } : source
      )
    );
  }, []);

  const handleApplyRecommendedWeights = useCallback(() => {
    setWeightDraftSources((prev) => applyRecommendedWeights(prev));
  }, [applyRecommendedWeights]);

  const handleResetWeightDraft = useCallback(() => {
    setWeightDraftSources(sources.map((source) => ({ ...source })));
  }, [sources]);

  const handleWeightModalDragEnd = useCallback(
    (event: any) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      setWeightDraftSources((prev) => {
        const oldIndex = prev.findIndex((source) => source.key === active.id);
        const newIndex = prev.findIndex((source) => source.key === over.id);
        if (oldIndex === -1 || newIndex === -1) return prev;
        return applyRecommendedWeights(arrayMove(prev, oldIndex, newIndex));
      });
    },
    [applyRecommendedWeights]
  );

  const recommendedWeightMap = useMemo(
    () => buildRecommendedWeightMap(weightDraftSources),
    [buildRecommendedWeightMap, weightDraftSources]
  );

  const weightModalChanged = useMemo(() => {
    if (weightDraftSources.length !== sources.length) return false;
    return weightDraftSources.some((source, index) => {
      const current = sources[index];
      return (
        !current ||
        current.key !== source.key ||
        (current.weight ?? 0) !== (source.weight ?? 0)
      );
    });
  }, [sources, weightDraftSources]);

  const handleSaveWeightConfig = useCallback(() => {
    withLoading('saveWeightConfig', async () => {
      await callSourceApi({
        action: 'batch_update_weights',
        weights: weightDraftSources.map((source) => ({
          key: source.key,
          weight: source.weight ?? 0,
        })),
        order: weightDraftSources.map((source) => source.key),
      });
      setSources(weightDraftSources.map((source) => ({ ...source })));
      setOrderChanged(false);
      handleCloseWeightModal();
    }).catch(() => {
      console.error('操作失败', 'batch_update_weights');
    });
  }, [callSourceApi, handleCloseWeightModal, weightDraftSources, withLoading]);

  // 有效性检测函数
  const handleValidateSources = async () => {
    if (!searchKeyword.trim()) {
      showAlert({
        type: 'warning',
        title: '请输入搜索关键词',
        message: '搜索关键词不能为空',
      });
      return;
    }

    await withLoading('validateSources', async () => {
      setIsValidating(true);
      setValidationResults([]); // 清空之前的结果
      setShowValidationModal(false); // 立即关闭弹窗

      // 初始化所有视频源为检测中状态
      const initialResults = sources.map((source) => ({
        key: source.key,
        name: source.name,
        status: 'validating' as const,
        message: '检测中...',
        resultCount: 0,
      }));
      setValidationResults(initialResults);

      try {
        // 使用EventSource接收流式数据
        const eventSource = new EventSource(
          `/api/admin/source/validate?q=${encodeURIComponent(
            searchKeyword.trim()
          )}`
        );

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            switch (data.type) {
              case 'start':
                console.log(`开始检测 ${data.totalSources} 个视频源`);
                break;

              case 'source_result':
              case 'source_error':
                // 更新验证结果
                setValidationResults((prev) => {
                  const existing = prev.find((r) => r.key === data.source);
                  if (existing) {
                    return prev.map((r) =>
                      r.key === data.source
                        ? {
                            key: data.source,
                            name:
                              sources.find((s) => s.key === data.source)
                                ?.name || data.source,
                            status: data.status,
                            message: `${data.message || '检测失败'} · ${
                              data.latencyMs || 0
                            }ms · 连续失败 ${data.consecutiveFailures || 0} 次`,
                            resultCount: data.status === 'valid' ? 1 : 0,
                          }
                        : r
                    );
                  } else {
                    return [
                      ...prev,
                      {
                        key: data.source,
                        name:
                          sources.find((s) => s.key === data.source)?.name ||
                          data.source,
                        status: data.status,
                        message: `${data.message || '检测失败'} · ${
                          data.latencyMs || 0
                        }ms · 连续失败 ${data.consecutiveFailures || 0} 次`,
                        resultCount: data.status === 'valid' ? 1 : 0,
                      },
                    ];
                  }
                });
                break;

              case 'complete':
                setHealthEpoch((value) => value + 1);
                console.log(
                  `检测完成，共检测 ${data.completedSources} 个视频源`
                );
                eventSource.close();
                setIsValidating(false);
                break;
            }
          } catch (error) {
            console.error('解析EventSource数据失败:', error);
          }
        };

        eventSource.onerror = (error) => {
          console.error('EventSource错误:', error);
          eventSource.close();
          setIsValidating(false);
          showAlert({
            type: 'error',
            title: '验证失败',
            message: '连接错误，请重试',
          });
        };

        // 设置超时，防止长时间等待
        setTimeout(() => {
          if (eventSource.readyState === EventSource.OPEN) {
            eventSource.close();
            setIsValidating(false);
            showAlert({
              type: 'warning',
              title: '验证超时',
              message: '检测超时，请重试',
            });
          }
        }, 60000); // 60秒超时
      } catch (error) {
        setIsValidating(false);
        showAlert({
          type: 'error',
          title: '验证失败',
          message: error instanceof Error ? error.message : '未知错误',
        });
        throw error;
      }
    });
  };

  // 获取有效性状态显示
  const getValidationStatus = (sourceKey: string) => {
    const result = validationResults.find((r) => r.key === sourceKey);
    if (!result) return null;

    switch (result.status) {
      case 'validating':
        return {
          text: '检测中',
          className:
            'bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300',
          icon: '⟳',
          message: result.message,
        };
      case 'valid':
        return {
          text: '有效',
          className:
            'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300',
          icon: '✓',
          message: result.message,
        };
      case 'no_results':
        return {
          text: '无法搜索',
          className:
            'bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300',
          icon: '⚠',
          message: result.message,
        };
      case 'invalid':
        return {
          text: '无效',
          className:
            'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300',
          icon: '✗',
          message: result.message,
        };
      default:
        return null;
    }
  };

  const WeightModalInput = memo(
    ({ sourceKey, weight }: { sourceKey: string; weight: number }) => {
      const [localWeight, setLocalWeight] = useState(weight);

      useEffect(() => {
        setLocalWeight(weight);
      }, [weight]);

      const commitWeight = (value: number) => {
        const clampedValue = Math.min(100, Math.max(0, value));
        setLocalWeight(clampedValue);
        handleWeightDraftChange(sourceKey, clampedValue);
      };

      return (
        <div
          className='flex items-center gap-3'
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          <input
            type='range'
            min='0'
            max='100'
            value={localWeight}
            onChange={(e) => commitWeight(parseInt(e.target.value) || 0)}
            className='w-full accent-blue-600'
          />
          <input
            type='number'
            inputMode='numeric'
            min='0'
            max='100'
            value={localWeight}
            onChange={(e) => {
              const nextValue = parseInt(e.target.value) || 0;
              const clampedValue = Math.min(100, Math.max(0, nextValue));
              setLocalWeight(clampedValue);
            }}
            onBlur={(e) => commitWeight(parseInt(e.target.value) || 0)}
            className='w-20 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent'
          />
        </div>
      );
    }
  );

  const WeightModalRow = memo(
    ({
      source,
      index,
      recommendedWeight,
    }: {
      source: DataSource;
      index: number;
      recommendedWeight: number;
    }) => {
      const { attributes, listeners, setNodeRef, transform, transition } =
        useSortable({ id: source.key });

      const style = {
        transform: CSS.Transform.toString(transform),
        transition,
      } as React.CSSProperties;

      return (
        <div
          ref={setNodeRef}
          style={style}
          className='grid grid-cols-[88px_minmax(0,1fr)_112px_112px_220px] items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-xs transition hover:border-blue-200 hover:shadow-sm dark:border-gray-700 dark:bg-gray-800/90 dark:hover:border-blue-800'
        >
          <div
            className='flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400 cursor-grab'
            style={{ touchAction: 'none' }}
            {...attributes}
            {...listeners}
          >
            <GripVertical size={16} />
            <span className='font-medium text-gray-700 dark:text-gray-200'>
              #{index + 1}
            </span>
          </div>
          <div className='min-w-0'>
            <div className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'>
              {source.name}
            </div>
            <div className='truncate text-xs text-gray-500 dark:text-gray-400'>
              {source.key}
            </div>
          </div>
          <div>
            <span
              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                source.disabled
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                  : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
              }`}
            >
              {source.disabled ? '已禁用' : '启用中'}
            </span>
          </div>
          <div>
            <span className='inline-flex rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'>
              {recommendedWeight}
            </span>
          </div>
          <WeightModalInput
            sourceKey={source.key}
            weight={source.weight ?? 0}
          />
        </div>
      );
    }
  );

  const SourceRow = memo(({ source }: { source: DataSource }) => {
    return (
      <tr className='group hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors'>
        <td className='px-2 py-4 text-center' data-admin-filter>
          <input
            type='checkbox'
            aria-label={'选择视频源 ' + source.name}
            checked={selectedSources.has(source.key)}
            onChange={(e) => handleSelectSource(source.key, e.target.checked)}
            className='w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded-sm focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600'
          />
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
          {source.name}
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
          {source.key}
        </td>
        <td
          className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 max-w-48 truncate'
          title={source.api}
        >
          {source.api}
        </td>
        <td
          className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 max-w-32 truncate'
          title={source.detail || '-'}
        >
          {source.detail || '-'}
        </td>
        <td className='px-6 py-4 whitespace-nowrap max-w-4'>
          <span
            className={`px-2 py-1 text-xs rounded-full ${
              !source.disabled
                ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
            }`}
          >
            {!source.disabled ? '启用中' : '已禁用'}
          </span>
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-center'>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleToggleProxyMode(source.key);
            }}
            disabled={isLoading(`toggleProxyMode_${source.key}`)}
            className={`relative inline-flex items-center h-6 w-11 rounded-full transition-colors ${
              source.proxyMode
                ? 'bg-blue-600 dark:bg-blue-500'
                : 'bg-gray-200 dark:bg-gray-700'
            } ${
              isLoading(`toggleProxyMode_${source.key}`)
                ? 'opacity-50 cursor-not-allowed'
                : 'cursor-pointer'
            }`}
            title={source.proxyMode ? '代理模式已启用' : '代理模式已禁用'}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                source.proxyMode ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </td>
        <td className='px-6 py-4 whitespace-nowrap max-w-4'>
          {(() => {
            const status = getValidationStatus(source.key);
            if (!status) {
              return (
                <span className='px-2 py-1 text-xs rounded-full bg-gray-100 dark:bg-gray-900/20 text-gray-600 dark:text-gray-400'>
                  未检测
                </span>
              );
            }
            return (
              <span
                className={`px-2 py-1 text-xs rounded-full ${status.className}`}
                title={status.message}
              >
                {status.icon} {status.text}
              </span>
            );
          })()}
        </td>
        <td className='sticky right-0 bg-white px-4 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2 dark:bg-gray-900 group-hover:bg-gray-50 dark:group-hover:bg-gray-800'>
          <button
            onClick={() => handleToggleEnable(source.key)}
            disabled={isLoading(`toggleSource_${source.key}`)}
            className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium ${
              !source.disabled
                ? buttonStyles.roundedDanger
                : buttonStyles.roundedSuccess
            } transition-colors ${
              isLoading(`toggleSource_${source.key}`)
                ? 'opacity-50 cursor-not-allowed'
                : ''
            }`}
          >
            {!source.disabled ? '禁用' : '启用'}
          </button>
          {source.from !== 'config' && (
            <button
              onClick={() => handleDelete(source.key)}
              disabled={isLoading(`deleteSource_${source.key}`)}
              className={`${buttonStyles.roundedSecondary} ${
                isLoading(`deleteSource_${source.key}`)
                  ? 'opacity-50 cursor-not-allowed'
                  : ''
              }`}
            >
              删除
            </button>
          )}
        </td>
      </tr>
    );
  });

  // 全选/取消全选
  const handleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        const allKeys = visibleSources.map((s) => s.key);
        setSelectedSources(new Set(allKeys));
      } else {
        setSelectedSources(new Set());
      }
    },
    [visibleSources]
  );

  // 单个选择
  const handleSelectSource = useCallback((key: string, checked: boolean) => {
    setSelectedSources((prev) => {
      const newSelected = new Set(prev);
      if (checked) {
        newSelected.add(key);
      } else {
        newSelected.delete(key);
      }
      return newSelected;
    });
  }, []);

  // 批量操作
  const handleBatchOperation = async (
    action: 'batch_enable' | 'batch_disable' | 'batch_delete'
  ) => {
    if (selectedSources.size === 0) {
      showAlert({
        type: 'warning',
        title: '请先选择要操作的视频源',
        message: '请选择至少一个视频源',
      });
      return;
    }

    const keys = Array.from(selectedSources);
    let confirmMessage = '';
    let actionName = '';

    switch (action) {
      case 'batch_enable':
        confirmMessage = `确定要启用选中的 ${keys.length} 个视频源吗？`;
        actionName = '批量启用';
        break;
      case 'batch_disable':
        confirmMessage = `确定要禁用选中的 ${keys.length} 个视频源吗？`;
        actionName = '批量禁用';
        break;
      case 'batch_delete':
        confirmMessage = `确定要删除选中的 ${keys.length} 个视频源吗？此操作不可恢复！`;
        actionName = '批量删除';
        break;
    }

    // 显示确认弹窗
    setConfirmModal({
      isOpen: true,
      title: '确认操作',
      message: confirmMessage,
      onConfirm: async () => {
        try {
          const result = await withLoading(`batchSource_${action}`, () =>
            callSourceApi({ action, keys })
          );

          // 根据操作类型和结果显示不同的消息
          if (
            action === 'batch_delete' &&
            result?.deleted !== undefined &&
            result?.skipped !== undefined
          ) {
            const { deleted, skipped } = result;
            if (skipped > 0) {
              showAlert({
                type: 'warning',
                title: '批量删除完成',
                message: `成功删除了 ${deleted} 个视频源，跳过了 ${skipped} 个配置文件中的源（不可删除）`,
                timer: 3000,
              });
            } else if (deleted > 0) {
              showAlert({
                type: 'success',
                title: '批量删除成功',
                message: `成功删除了 ${deleted} 个视频源`,
                timer: 2000,
              });
            } else {
              showAlert({
                type: 'warning',
                title: '无法删除',
                message: '所选视频源均为配置文件中的源，不可删除',
                timer: 3000,
              });
            }
          } else {
            showAlert({
              type: 'success',
              title: `${actionName}成功`,
              message: `${actionName}了 ${keys.length} 个视频源`,
              timer: 2000,
            });
          }

          // 重置选择状态
          setSelectedSources(new Set());
        } catch (err) {
          showAlert({
            type: 'error',
            title: `${actionName}失败`,
            message: err instanceof Error ? err.message : '操作失败',
          });
        }
        setConfirmModal({
          isOpen: false,
          title: '',
          message: '',
          onConfirm: () => {},
          onCancel: () => {},
        });
      },
      onCancel: () => {
        setConfirmModal({
          isOpen: false,
          title: '',
          message: '',
          onConfirm: () => {},
          onCancel: () => {},
        });
      },
    });
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
      <div className='flex flex-wrap items-center justify-between gap-4'>
        <div>
          <h2 className='text-base font-semibold'>视频源列表</h2>
          <p className='mt-1 text-xs text-slate-500'>
            共 {sources.length} 个 ·{' '}
            {sources.filter((source) => !source.disabled).length} 个启用
          </p>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <button
            onClick={() => setShowValidationModal(true)}
            disabled={isValidating}
            className={buttonStyles.primary}
          >
            {isValidating ? '检测中…' : '有效性检测'}
          </button>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className={
              showAddForm ? buttonStyles.secondary : buttonStyles.success
            }
          >
            {showAddForm ? '取消添加' : '添加视频源'}
          </button>
        </div>
      </div>
      <div
        className='flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-900'
        data-admin-filter
      >
        <input
          type='search'
          aria-label='搜索视频源'
          placeholder='搜索名称、Key 或 API 地址'
          value={sourceQuery}
          onChange={(event) => {
            setSourceQuery(event.target.value);
            setSelectedSources(new Set());
          }}
          className='min-w-0 flex-1 basis-60 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800'
        />
        <select
          aria-label='视频源状态'
          value={sourceStatus}
          onChange={(event) => {
            setSourceStatus(event.target.value as SourceListStatus);
            setSelectedSources(new Set());
          }}
          className='rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800'
        >
          <option value='all'>全部状态</option>
          <option value='enabled'>已启用</option>
          <option value='disabled'>已禁用</option>
        </select>
        <span role='status' className='text-xs text-slate-500'>
          显示 {visibleSources.length} / {sources.length}
        </span>
        {(sourceQuery || sourceStatus !== 'all') && (
          <button
            onClick={() => {
              setSourceQuery('');
              setSourceStatus('all');
              setSelectedSources(new Set());
            }}
            className='text-xs font-medium text-emerald-600'
          >
            清除筛选
          </button>
        )}
      </div>
      <div className='flex flex-wrap items-center gap-2' data-admin-filter>
        <span className='mr-1 text-xs text-slate-400'>批量设置</span>
        <button onClick={openWeightModal} className={buttonStyles.quickAction}>
          权重排序
        </button>
        <button
          onClick={openSpecialSourcesModal}
          className={buttonStyles.quickAction}
        >
          特殊源 · {config.SpecialSourceApis?.length || 0}
        </button>
        <button
          onClick={openClientAdSourcesModal}
          className={buttonStyles.quickAction}
        >
          客户端广告过滤
        </button>
      </div>
      {selectedSources.size > 0 && (
        <div
          className='flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950'
          data-admin-filter
        >
          <span className='mr-auto text-sm font-medium text-emerald-800 dark:text-emerald-200'>
            已选 {selectedSources.size} 个视频源
          </span>
          <button
            onClick={() => setSelectedSources(new Set())}
            className={buttonStyles.quickAction}
          >
            取消选择
          </button>
          <button
            disabled={isLoading('batchSource_batch_enable')}
            onClick={() => handleBatchOperation('batch_enable')}
            className={buttonStyles.success}
          >
            批量启用
          </button>
          <button
            disabled={isLoading('batchSource_batch_disable')}
            onClick={() => handleBatchOperation('batch_disable')}
            className={buttonStyles.warning}
          >
            批量禁用
          </button>
          <button
            disabled={isLoading('batchSource_batch_delete')}
            onClick={() => handleBatchOperation('batch_delete')}
            className={buttonStyles.danger}
          >
            批量删除
          </button>
        </div>
      )}

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
            <input
              type='text'
              placeholder='Key'
              value={newSource.key}
              onChange={(e) =>
                setNewSource((prev) => ({ ...prev, key: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='API 地址'
              value={newSource.api}
              onChange={(e) =>
                setNewSource((prev) => ({ ...prev, api: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='Detail 地址（选填）'
              value={newSource.detail}
              onChange={(e) =>
                setNewSource((prev) => ({ ...prev, detail: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
          </div>
          <div className='flex justify-end'>
            <button
              onClick={handleAddSource}
              disabled={
                !newSource.name ||
                !newSource.key ||
                !newSource.api ||
                isLoading('addSource')
              }
              className={`w-full sm:w-auto px-4 py-2 ${
                !newSource.name ||
                !newSource.key ||
                !newSource.api ||
                isLoading('addSource')
                  ? buttonStyles.disabled
                  : buttonStyles.success
              }`}
            >
              {isLoading('addSource') ? '添加中...' : '添加'}
            </button>
          </div>
        </div>
      )}

      {/* 视频源表格 */}
      <div
        className='border border-gray-200 dark:border-gray-700 rounded-lg max-h-[65vh] overflow-auto relative'
        data-table='source-list'
      >
        <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
          <thead className='bg-gray-50 dark:bg-gray-900 sticky top-0 z-10'>
            <tr>
              <th className='w-12 px-2 py-3 text-center' data-admin-filter>
                <input
                  type='checkbox'
                  aria-label='全选当前筛选的视频源'
                  checked={selectAll}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                  className='w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded-sm focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600'
                />
              </th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                名称
              </th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                Key
              </th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                API 地址
              </th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                Detail 地址
              </th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                状态
              </th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                代理模式
              </th>
              <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                有效性
              </th>
              <th className='sticky right-0 bg-gray-50 px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider dark:bg-gray-900'>
                操作
              </th>
            </tr>
          </thead>
          <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
            {visibleSources.map((source) => (
              <SourceRow key={source.key} source={source} />
            ))}
            {!visibleSources.length && (
              <tr>
                <td
                  colSpan={9}
                  className='px-6 py-12 text-center text-sm text-slate-500'
                >
                  {sources.length
                    ? '没有符合筛选条件的视频源，请调整搜索或状态。'
                    : '尚未添加视频源，可添加单个源或使用配置订阅。'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className='text-xs text-slate-400'>
        全选仅针对当前筛选结果；切换筛选会清除选择。表格可横向滚动，操作列保持可见。
      </p>
      <SourceHealthPanel
        sources={config.SourceConfig || []}
        epoch={healthEpoch}
      />

      {showSpecialSourcesModal &&
        createPortal(
          <div
            className='fixed inset-0 z-10000 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs'
            onClick={closeSpecialSourcesModal}
          >
            <div
              className='flex max-h-[84vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-5 dark:border-gray-700'>
                <div>
                  <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
                    特殊源设置
                  </h3>
                  <p className='mt-1 text-sm text-gray-600 dark:text-gray-400'>
                    选中的视频源默认对普通搜索隐藏，仅在当前设备访问 /special
                    开启后参与普通 Web 搜索。
                  </p>
                </div>
                <button
                  onClick={closeSpecialSourcesModal}
                  className='text-2xl leading-none text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300'
                  aria-label='关闭特殊源设置弹窗'
                >
                  ×
                </button>
              </div>

              <div className='min-h-0 flex-1 overflow-y-auto px-6 py-5'>
                <div className='mb-5 rounded-lg border border-rose-200 bg-rose-50 p-4 dark:border-rose-800 dark:bg-rose-900/20'>
                  <div className='text-sm font-medium text-rose-800 dark:text-rose-300'>
                    配置说明
                  </div>
                  <p className='mt-1 text-sm text-rose-700 dark:text-rose-400'>
                    这里维护的是特殊源列表，不是用户权限；TVBox、OrionTV、WebTV
                    始终不会使用这些特殊源。
                  </p>
                </div>

                <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3'>
                  {config?.SourceConfig?.map((source) => (
                    <label
                      key={source.key}
                      className='flex cursor-pointer items-center space-x-3 rounded-lg border border-gray-200 p-3 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900/50'
                    >
                      <input
                        type='checkbox'
                        checked={specialSourceDraftApis.includes(source.key)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSpecialSourceDraftApis((prev) =>
                              prev.includes(source.key)
                                ? prev
                                : [...prev, source.key]
                            );
                          } else {
                            setSpecialSourceDraftApis((prev) =>
                              prev.filter((api) => api !== source.key)
                            );
                          }
                        }}
                        className='rounded-sm border-gray-300 text-rose-600 focus:ring-rose-500 dark:border-gray-600 dark:bg-gray-700'
                      />
                      <div className='min-w-0 flex-1'>
                        <div className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'>
                          {source.name}
                        </div>
                        <div className='truncate text-xs text-gray-500 dark:text-gray-400'>
                          {source.key}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className='flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-gray-50 px-6 py-4 dark:border-gray-700 dark:bg-gray-900/30'>
                <div className='flex flex-wrap gap-2'>
                  <button
                    onClick={() => setSpecialSourceDraftApis([])}
                    className={buttonStyles.quickAction}
                  >
                    全不选
                  </button>
                  <button
                    onClick={() => {
                      const allApis =
                        config?.SourceConfig?.filter(
                          (source) => !source.disabled
                        ).map((source) => source.key) || [];
                      setSpecialSourceDraftApis(allApis);
                    }}
                    className={buttonStyles.quickAction}
                  >
                    全选启用源
                  </button>
                </div>
                <div className='flex items-center gap-3'>
                  <span className='text-sm text-gray-600 dark:text-gray-400'>
                    已选择：
                    <span className='font-medium text-rose-600 dark:text-rose-400'>
                      {specialSourceDraftApis.length} 个源
                    </span>
                  </span>
                  <button
                    onClick={closeSpecialSourcesModal}
                    className={buttonStyles.secondary}
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSaveSpecialSources}
                    disabled={isLoading('saveSpecialSources')}
                    className={`px-4 py-2 ${
                      isLoading('saveSpecialSources')
                        ? buttonStyles.disabled
                        : buttonStyles.success
                    }`}
                  >
                    {isLoading('saveSpecialSources') ? '保存中...' : '保存'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {showClientAdSourcesModal &&
        createPortal(
          <div
            className='fixed inset-0 z-10000 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs'
            onClick={closeClientAdSourcesModal}
          >
            <div
              className='flex max-h-[84vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-5 dark:border-gray-700'>
                <div>
                  <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
                    客户端去广告配置
                  </h3>
                  <p className='mt-1 text-sm text-gray-600 dark:text-gray-400'>
                    勾选后，用户使用 PureTV APP 或 OrionTV
                    观看这些视频源时，会自动过滤片头/插播广告。
                  </p>
                </div>
                <button
                  onClick={closeClientAdSourcesModal}
                  className='text-2xl leading-none text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300'
                  aria-label='关闭客户端去广告配置弹窗'
                >
                  ×
                </button>
              </div>

              <div className='min-h-0 flex-1 overflow-y-auto px-6 py-5'>
                <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3'>
                  {config?.SourceConfig?.map((source) => (
                    <label
                      key={source.key}
                      className='flex cursor-pointer items-center space-x-3 rounded-lg border border-gray-200 p-3 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900/50'
                    >
                      <input
                        type='checkbox'
                        checked={clientAdSourceDraftApis.includes(source.key)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setClientAdSourceDraftApis((prev) =>
                              prev.includes(source.key)
                                ? prev
                                : [...prev, source.key]
                            );
                          } else {
                            setClientAdSourceDraftApis((prev) =>
                              prev.filter((api) => api !== source.key)
                            );
                          }
                        }}
                        className='rounded-sm border-gray-300 text-amber-600 focus:ring-amber-500 dark:border-gray-600 dark:bg-gray-700'
                      />
                      <div className='min-w-0 flex-1'>
                        <div className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'>
                          {source.name}
                        </div>
                        <div className='truncate text-xs text-gray-500 dark:text-gray-400'>
                          {source.key}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className='flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-gray-50 px-6 py-4 dark:border-gray-700 dark:bg-gray-900/30'>
                <div className='flex flex-wrap gap-2'>
                  <button
                    onClick={() => setClientAdSourceDraftApis([])}
                    className={buttonStyles.quickAction}
                  >
                    全不选
                  </button>
                  <button
                    onClick={() => {
                      const allApis =
                        config?.SourceConfig?.filter(
                          (source) => !source.disabled
                        ).map((source) => source.key) || [];
                      setClientAdSourceDraftApis(allApis);
                    }}
                    className={buttonStyles.quickAction}
                  >
                    全选启用源
                  </button>
                </div>
                <div className='flex items-center gap-3'>
                  <span className='text-sm text-gray-600 dark:text-gray-400'>
                    已选择：
                    <span className='font-medium text-amber-600 dark:text-amber-400'>
                      {clientAdSourceDraftApis.length} 个源
                    </span>
                  </span>
                  <button
                    onClick={closeClientAdSourcesModal}
                    className={buttonStyles.secondary}
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSaveClientAdSources}
                    disabled={isLoading('saveClientAdSources')}
                    className={`px-4 py-2 ${
                      isLoading('saveClientAdSources')
                        ? buttonStyles.disabled
                        : buttonStyles.success
                    }`}
                  >
                    {isLoading('saveClientAdSources') ? '保存中...' : '保存'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {showWeightModal &&
        createPortal(
          <>
            <div
              className='fixed inset-0 bg-black/60 backdrop-blur-xs z-10000'
              onClick={handleCloseWeightModal}
              onTouchMove={(e) => {
                e.preventDefault();
              }}
              onWheel={(e) => {
                e.preventDefault();
              }}
              style={{
                touchAction: 'none',
              }}
            />
            <div
              className='fixed left-1/2 top-1/2 z-10001 flex w-[calc(100%-1rem)] max-w-6xl max-h-[90vh] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='flex items-start justify-between gap-4 border-b border-gray-200 dark:border-gray-700 px-6 py-5'>
                <div>
                  <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
                    视频源权重设置
                  </h3>
                </div>
                <button
                  onClick={handleCloseWeightModal}
                  className='text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors text-2xl leading-none'
                  aria-label='关闭权重设置弹窗'
                >
                  ×
                </button>
              </div>

              <div
                className='flex-1 min-h-0 overflow-y-auto px-0 overscroll-contain'
                data-panel-content
                data-weight-modal-scroll
                onTouchMove={(e) => {
                  e.stopPropagation();
                }}
                onWheel={(e) => {
                  e.stopPropagation();
                }}
                style={{
                  touchAction: 'pan-y',
                  overscrollBehavior: 'contain',
                }}
              >
                <div className='flex flex-wrap items-center justify-between gap-3 px-6 py-4'>
                  <div className='text-sm text-gray-600 dark:text-gray-400'>
                    排序越靠前，推荐权重越高；拖动后再次生成推荐值时，会把当前列表均匀映射到
                    0~40。
                  </div>
                  <div className='flex flex-wrap items-center gap-2'>
                    <button
                      onClick={handleApplyRecommendedWeights}
                      className={buttonStyles.primarySmall}
                    >
                      按当前顺序生成推荐权重
                    </button>
                    <button
                      onClick={handleResetWeightDraft}
                      className={buttonStyles.secondarySmall}
                    >
                      恢复当前配置
                    </button>
                  </div>
                </div>

                <div className='px-6 pb-6'>
                  <div className='overflow-x-auto'>
                    <div className='grid min-w-[820px] grid-cols-[88px_minmax(0,1fr)_112px_112px_220px] gap-3 px-4 pb-3 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400'>
                      <div>排序</div>
                      <div>视频源</div>
                      <div>状态</div>
                      <div>推荐值</div>
                      <div>生效权重</div>
                    </div>
                    <div className='min-w-[820px] rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/20 p-3'>
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleWeightModalDragEnd}
                        autoScroll={false}
                        modifiers={[
                          restrictToVerticalAxis,
                          restrictToParentElement,
                        ]}
                      >
                        <SortableContext
                          items={weightDraftSources.map((source) => source.key)}
                          strategy={verticalListSortingStrategy}
                        >
                          <div className='space-y-3'>
                            {weightDraftSources.map((source, index) => {
                              const recommendedWeight =
                                recommendedWeightMap.get(source.key) ?? 0;
                              return (
                                <WeightModalRow
                                  key={source.key}
                                  source={source}
                                  index={index}
                                  recommendedWeight={recommendedWeight}
                                />
                              );
                            })}
                          </div>
                        </SortableContext>
                      </DndContext>
                    </div>
                  </div>
                </div>
              </div>

              <div className='flex items-center justify-end gap-3 border-t border-gray-200 dark:border-gray-700 px-6 py-4'>
                <div className='flex items-center gap-3'>
                  <button
                    onClick={handleCloseWeightModal}
                    className={buttonStyles.secondary}
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSaveWeightConfig}
                    disabled={
                      !weightModalChanged || isLoading('saveWeightConfig')
                    }
                    className={`px-4 py-2 ${
                      !weightModalChanged || isLoading('saveWeightConfig')
                        ? buttonStyles.disabled
                        : buttonStyles.success
                    }`}
                  >
                    {isLoading('saveWeightConfig') ? '保存中...' : '保存'}
                  </button>
                </div>
              </div>
            </div>
          </>,
          document.body
        )}

      {/* 有效性检测弹窗 */}
      {showValidationModal &&
        createPortal(
          <div
            className='fixed inset-0 bg-black/50 flex items-center justify-center z-50'
            onClick={() => setShowValidationModal(false)}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4'
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className='text-lg font-medium text-gray-900 dark:text-gray-100 mb-4'>
                视频源有效性检测
              </h3>
              <p className='text-sm text-gray-600 dark:text-gray-400 mb-4'>
                请输入检测用的搜索关键词
              </p>
              <div className='space-y-4'>
                <input
                  type='text'
                  placeholder='请输入搜索关键词'
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                  className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                  onKeyPress={(e) =>
                    e.key === 'Enter' && handleValidateSources()
                  }
                />
                <div className='flex justify-end space-x-3'>
                  <button
                    onClick={() => setShowValidationModal(false)}
                    className='px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors'
                  >
                    取消
                  </button>
                  <button
                    onClick={handleValidateSources}
                    disabled={!searchKeyword.trim()}
                    className={`px-4 py-2 ${
                      !searchKeyword.trim()
                        ? buttonStyles.disabled
                        : buttonStyles.success
                    }`}
                  >
                    开始检测
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
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
        onConfirm={alertModal.onConfirm}
      />

      {/* 批量操作确认弹窗 */}
      {confirmModal.isOpen &&
        createPortal(
          <div
            className='fixed inset-0 bg-black/50 z-10020 flex items-center justify-center p-4'
            onClick={confirmModal.onCancel}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='p-6'>
                <div className='flex items-center justify-between mb-4'>
                  <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                    {confirmModal.title}
                  </h3>
                  <button
                    onClick={confirmModal.onCancel}
                    className='text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors'
                  >
                    <svg
                      className='w-5 h-5'
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M6 18L18 6M6 6l12 12'
                      />
                    </svg>
                  </button>
                </div>

                <div className='mb-6'>
                  <p className='text-sm text-gray-600 dark:text-gray-400'>
                    {confirmModal.message}
                  </p>
                </div>

                {/* 操作按钮 */}
                <div className='flex justify-end space-x-3'>
                  <button
                    onClick={confirmModal.onCancel}
                    className={`px-4 py-2 text-sm font-medium ${buttonStyles.secondary}`}
                  >
                    取消
                  </button>
                  <button
                    onClick={confirmModal.onConfirm}
                    disabled={
                      isLoading('batchSource_batch_enable') ||
                      isLoading('batchSource_batch_disable') ||
                      isLoading('batchSource_batch_delete')
                    }
                    className={`px-4 py-2 text-sm font-medium ${
                      isLoading('batchSource_batch_enable') ||
                      isLoading('batchSource_batch_disable') ||
                      isLoading('batchSource_batch_delete')
                        ? buttonStyles.disabled
                        : buttonStyles.success
                    }`}
                  >
                    {isLoading('batchSource_batch_enable') ||
                    isLoading('batchSource_batch_disable') ||
                    isLoading('batchSource_batch_delete')
                      ? '操作中...'
                      : '确认'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
