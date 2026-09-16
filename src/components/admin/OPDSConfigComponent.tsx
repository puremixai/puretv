
'use client';

import { AlertTriangle, Plus } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { AdminConfig } from '@/lib/admin.types';
import { adminFetch as fetch } from '@/lib/admin-fetch';
import { BookSource } from '@/lib/book.types';

import {
  AlertModal,
  buttonStyles,
  showError,
  showSuccess,
  useAlertModal,
  useLoadingState,
} from '@/components/admin/shared';

export const OPDSConfigComponent = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [enabled, setEnabled] = useState(false);
  const [cacheTTL, setCacheTTL] = useState(10 * 60 * 1000);
  const [sources, setSources] = useState<BookSource[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [legadoSubscriptionName, setLegadoSubscriptionName] = useState('');
  const [legadoSubscriptionUrl, setLegadoSubscriptionUrl] = useState('');
  const [legadoSubscriptions, setLegadoSubscriptions] = useState<
    NonNullable<AdminConfig['OPDSConfig']>['LegadoSubscriptions']
  >([]);
  const [showBooksDisclaimer, setShowBooksDisclaimer] = useState(false);
  const [booksCountdown, setBooksCountdown] = useState(10);

  useEffect(() => {
    if (!config?.OPDSConfig) return;
    setEnabled(config.OPDSConfig.Enabled || false);
    setCacheTTL(config.OPDSConfig.CacheTTL || 10 * 60 * 1000);
    setSources(
      (config.OPDSConfig.Sources || []).map((item, index) => ({
        id: item.id || `source_${index + 1}`,
        name: item.name || `书源 ${index + 1}`,
        type: 'opds' as const,
        url: item.url || '',
        enabled: item.enabled !== false,
        authMode: item.authMode || 'none',
        username: item.username || '',
        password: item.password || '',
        headerName: item.headerName || '',
        headerValue: item.headerValue || '',
        searchTemplate: item.searchTemplate || '',
        preferFormat: item.preferFormat || ['epub', 'pdf'],
        language: item.language || '',
      }))
    );
    setLegadoSubscriptions(config.OPDSConfig.LegadoSubscriptions || []);
    setEditingIndex(null);
  }, [config]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (showBooksDisclaimer && booksCountdown > 0) {
      timer = setTimeout(() => setBooksCountdown(booksCountdown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [showBooksDisclaimer, booksCountdown]);

  const updateSource = (index: number, patch: Partial<BookSource>) => {
    setSources((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, ...patch } : item))
    );
  };

  const addSource = () => {
    setSources((prev) => {
      const nextIndex = prev.length;
      setEditingIndex(nextIndex);
      return [
        ...prev,
        {
          id: `source_${nextIndex + 1}`,
          name: `书源 ${nextIndex + 1}`,
          type: 'opds' as const,
          url: '',
          enabled: true,
          authMode: 'none' as const,
          username: '',
          password: '',
          headerName: '',
          headerValue: '',
          searchTemplate: '',
          preferFormat: ['epub' as const, 'pdf' as const],
          language: '',
        },
      ];
    });
  };

  const removeSource = (index: number) => {
    setSources((prev) => prev.filter((_, idx) => idx !== index));
    setEditingIndex((prev) =>
      prev === index ? null : prev !== null && prev > index ? prev - 1 : prev
    );
  };

  const normalizeSource = (source: BookSource, index: number) => ({
    id: source.id?.trim() || `source_${index + 1}`,
    name: source.name?.trim() || `书源 ${index + 1}`,
    type: 'opds' as const,
    url: source.url?.trim() || '',
    enabled: source.enabled !== false,
    authMode: source.authMode || 'none',
    username: source.authMode === 'none' ? '' : source.username?.trim() || '',
    password: source.authMode === 'none' ? '' : source.password || '',
    headerName:
      source.authMode === 'header' ? source.headerName?.trim() || '' : '',
    headerValue: source.authMode === 'header' ? source.headerValue || '' : '',
    searchTemplate: source.searchTemplate?.trim() || '',
    preferFormat: source.preferFormat?.length
      ? source.preferFormat
      : ['epub', 'pdf'],
    language: source.language?.trim() || '',
  });

  const buildConfig = () => ({
    Enabled: enabled,
    CacheTTL: Math.max(60_000, cacheTTL || 10 * 60 * 1000),
    Sources: sources.map(normalizeSource).filter((source) => !!source.url),
  });

  const handleSave = async () => {
    await withLoading('saveOPDSConfig', async () => {
      try {
        if (!config) throw new Error('配置未加载');
        const response = await fetch('/api/admin/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ OPDSConfig: buildConfig() }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || '保存失败');
        showSuccess('电子书源配置已保存', showAlert);
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

  const handleTest = async (index: number) => {
    await withLoading(`testOPDSConfig-${index}`, async () => {
      try {
        const source = normalizeSource(sources[index], index);
        if (!source.url) throw new Error('请先填写书源地址');
        const response = await fetch('/api/admin/opds', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            Enabled: true,
            CacheTTL: Math.max(60_000, cacheTTL || 10 * 60 * 1000),
            Sources: [source],
          }),
        });
        const data = await response.json();
        if (!response.ok || !data.success)
          throw new Error(data.message || data.error || '测试连接失败');
        const result = Array.isArray(data.results) ? data.results[0] : null;
        showSuccess(
          result
            ? `${result.name}: 分类${
                result.capability.catalogSupported ? '√' : '×'
              } / 搜索${result.capability.searchSupported ? '√' : '×'}`
            : '测试成功',
          showAlert
        );
      } catch (error) {
        showError(
          error instanceof Error ? error.message : '测试连接失败',
          showAlert
        );
        throw error;
      }
    });
  };

  const importLegadoSubscription = async () => {
    await withLoading('importLegadoSubscription', async () => {
      try {
        const response = await fetch('/api/admin/legado-subscriptions/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: legadoSubscriptionName,
            url: legadoSubscriptionUrl,
          }),
        });
        const data = await response.json();
        if (!response.ok || !data.success)
          throw new Error(data.error || '导入 Legado 订阅失败');
        setLegadoSubscriptionName('');
        setLegadoSubscriptionUrl('');
        showSuccess(
          `已导入 ${data.subscription?.sourceCount || 0} 个 Legado 书源`,
          showAlert
        );
        await refreshConfig();
      } catch (error) {
        showError(
          error instanceof Error ? error.message : '导入 Legado 订阅失败',
          showAlert
        );
        throw error;
      }
    });
  };

  const refreshLegadoSubscription = async (id: string) => {
    await withLoading(`refreshLegadoSubscription-${id}`, async () => {
      try {
        const response = await fetch(
          `/api/admin/legado-subscriptions/${encodeURIComponent(id)}/refresh`,
          { method: 'POST' }
        );
        const data = await response.json();
        if (!response.ok || !data.success)
          throw new Error(data.error || '刷新 Legado 订阅失败');
        showSuccess(
          `已同步 ${data.subscription?.sourceCount || 0} 个 Legado 书源`,
          showAlert
        );
        await refreshConfig();
      } catch (error) {
        showError(
          error instanceof Error ? error.message : '刷新 Legado 订阅失败',
          showAlert
        );
        throw error;
      }
    });
  };

  const deleteLegadoSubscription = async (id: string) => {
    await withLoading(`deleteLegadoSubscription-${id}`, async () => {
      try {
        const response = await fetch(
          `/api/admin/legado-subscriptions/${encodeURIComponent(id)}`,
          { method: 'DELETE' }
        );
        const data = await response.json();
        if (!response.ok || !data.success)
          throw new Error(data.error || '删除 Legado 订阅失败');
        showSuccess('Legado 订阅已删除', showAlert);
        await refreshConfig();
      } catch (error) {
        showError(
          error instanceof Error ? error.message : '删除 Legado 订阅失败',
          showAlert
        );
        throw error;
      }
    });
  };

  return (
    <div className='space-y-6'>
      <div className='rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20'>
        <h3 className='mb-2 text-sm font-medium text-amber-900 dark:text-amber-100'>
          关于电子书馆 / OPDS / Legado
        </h3>
        <div className='space-y-1 text-sm text-amber-800 dark:text-amber-200'>
          <p>• OPDS 源手动配置。</p>
          <p>• Legado 通过订阅 URL 导入。</p>
        </div>
      </div>

      <div className='flex items-center justify-between border-b border-gray-200 py-3 dark:border-gray-700'>
        <div>
          <h3 className='text-sm font-medium text-gray-900 dark:text-white'>
            启用电子书馆
          </h3>
          <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
            关闭后不会展示电子书入口。
          </p>
        </div>
        <button
          onClick={() => {
            if (!enabled) {
              setShowBooksDisclaimer(true);
              setBooksCountdown(10);
            } else {
              setEnabled(false);
            }
          }}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            enabled ? 'bg-amber-600' : 'bg-gray-200 dark:bg-gray-700'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* 电子书馆免责声明弹窗 */}
      {showBooksDisclaimer &&
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
                      setShowBooksDisclaimer(false);
                      setBooksCountdown(10);
                    }}
                    className={buttonStyles.secondary}
                  >
                    取消
                  </button>
                  <button
                    onClick={() => {
                      setEnabled(true);
                      setShowBooksDisclaimer(false);
                      setBooksCountdown(10);
                    }}
                    disabled={booksCountdown > 0}
                    className={
                      booksCountdown > 0
                        ? buttonStyles.disabled
                        : buttonStyles.danger
                    }
                  >
                    {booksCountdown > 0
                      ? `确认 (${booksCountdown}s)`
                      : '确认启用'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      <div>
        <label className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'>
          Feed 缓存时长（毫秒）
        </label>
        <input
          type='number'
          min='60000'
          value={cacheTTL}
          onChange={(e) =>
            setCacheTTL(parseInt(e.target.value) || 10 * 60 * 1000)
          }
          className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
        />
      </div>

      <div className='rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20'>
        <div className='mb-3 flex items-center justify-between gap-3'>
          <div>
            <h4 className='text-sm font-medium text-amber-900 dark:text-amber-100'>
              Legado 订阅
            </h4>
            <p className='mt-1 text-xs text-amber-800 dark:text-amber-200'>
              目前处于实验性阶段，仅支持部分简单订阅。
            </p>
          </div>
          <button
            type='button'
            onClick={importLegadoSubscription}
            disabled={
              !legadoSubscriptionUrl.trim() ||
              isLoading('importLegadoSubscription')
            }
            className={buttonStyles.primarySmall}
          >
            {isLoading('importLegadoSubscription') ? '导入中...' : '导入订阅'}
          </button>
        </div>
        <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
          <input
            type='text'
            value={legadoSubscriptionName}
            onChange={(e) => setLegadoSubscriptionName(e.target.value)}
            placeholder='订阅名称（可选）'
            className='rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-amber-800 dark:bg-gray-900 dark:text-gray-100'
          />
          <input
            type='text'
            value={legadoSubscriptionUrl}
            onChange={(e) => setLegadoSubscriptionUrl(e.target.value)}
            placeholder='https://example.com/bookSource.json'
            className='rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-amber-800 dark:bg-gray-900 dark:text-gray-100'
          />
        </div>
        <div className='mt-4 space-y-2'>
          {(legadoSubscriptions || []).length === 0 ? (
            <div className='text-xs text-amber-800 dark:text-amber-200'>
              暂无 Legado 订阅。
            </div>
          ) : (
            (legadoSubscriptions || []).map((sub) => (
              <div
                key={sub.id}
                className='rounded-lg border border-amber-200 bg-white p-3 text-sm dark:border-amber-800 dark:bg-gray-900'
              >
                <div className='flex flex-wrap items-start justify-between gap-3'>
                  <div className='min-w-0 flex-1'>
                    <div className='font-medium text-gray-900 dark:text-gray-100'>
                      {sub.name}
                    </div>
                    <div className='mt-1 break-all text-xs text-gray-500 dark:text-gray-400'>
                      {sub.url}
                    </div>
                    <div className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                      源数量：{sub.sourceCount || 0} · 上次同步：
                      {sub.lastSuccessAt
                        ? new Date(sub.lastSuccessAt).toLocaleString()
                        : '-'}
                    </div>
                    {sub.lastError ? (
                      <div className='mt-1 text-xs text-red-500'>
                        {sub.lastError}
                      </div>
                    ) : null}
                  </div>
                  <div className='flex items-center gap-2'>
                    <button
                      type='button'
                      onClick={() =>
                        setLegadoSubscriptions((prev) =>
                          (prev || []).map((item) =>
                            item.id === sub.id
                              ? { ...item, enabled: item.enabled === false }
                              : item
                          )
                        )
                      }
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        sub.enabled !== false
                          ? 'bg-green-600'
                          : 'bg-gray-200 dark:bg-gray-700'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          sub.enabled !== false
                            ? 'translate-x-6'
                            : 'translate-x-1'
                        }`}
                      />
                    </button>
                    <button
                      type='button'
                      onClick={() => refreshLegadoSubscription(sub.id)}
                      disabled={isLoading(
                        `refreshLegadoSubscription-${sub.id}`
                      )}
                      className={buttonStyles.secondarySmall}
                    >
                      {isLoading(`refreshLegadoSubscription-${sub.id}`)
                        ? '同步中...'
                        : '同步'}
                    </button>
                    <button
                      type='button'
                      onClick={() => deleteLegadoSubscription(sub.id)}
                      disabled={isLoading(`deleteLegadoSubscription-${sub.id}`)}
                      className={buttonStyles.dangerSmall}
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className='space-y-4'>
        <div className='flex items-center justify-between'>
          <h3 className='text-sm font-medium text-gray-900 dark:text-white'>
            OPDS 书源列表
          </h3>
          <button
            type='button'
            onClick={addSource}
            className={buttonStyles.primary}
          >
            <Plus size={16} className='mr-1 inline' />
            添加 OPDS
          </button>
        </div>
        {sources.length === 0 ? (
          <div className='rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400'>
            暂无 OPDS 书源。
          </div>
        ) : null}
        <div className='space-y-3'>
          {sources.map((source, index) => {
            const isEditing = editingIndex === index;
            return (
              <div
                key={`opds-source-${index}`}
                className='rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900'
              >
                <div className='flex flex-wrap items-start justify-between gap-3'>
                  <div className='min-w-0 flex-1'>
                    <div className='font-medium text-gray-900 dark:text-gray-100'>
                      {source.name || `书源 ${index + 1}`}
                    </div>
                    <div className='mt-1 break-all text-xs text-gray-500 dark:text-gray-400'>
                      {source.url || '-'}
                    </div>
                  </div>
                  <div className='flex items-center gap-2'>
                    <button
                      type='button'
                      onClick={() =>
                        updateSource(index, {
                          enabled: source.enabled === false,
                        })
                      }
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        source.enabled !== false
                          ? 'bg-green-600'
                          : 'bg-gray-200 dark:bg-gray-700'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          source.enabled !== false
                            ? 'translate-x-6'
                            : 'translate-x-1'
                        }`}
                      />
                    </button>
                    <button
                      type='button'
                      onClick={() => handleTest(index)}
                      disabled={isLoading(`testOPDSConfig-${index}`)}
                      className={buttonStyles.primarySmall}
                    >
                      {isLoading(`testOPDSConfig-${index}`)
                        ? '测试中...'
                        : '测试'}
                    </button>
                    <button
                      type='button'
                      onClick={() => setEditingIndex(isEditing ? null : index)}
                      className={buttonStyles.secondarySmall}
                    >
                      {isEditing ? '收起' : '编辑'}
                    </button>
                    <button
                      type='button'
                      onClick={() => removeSource(index)}
                      className={buttonStyles.dangerSmall}
                    >
                      删除
                    </button>
                  </div>
                </div>
                {isEditing ? (
                  <div className='mt-4 grid grid-cols-1 gap-4 border-t border-gray-200 pt-4 dark:border-gray-700 md:grid-cols-2'>
                    <input
                      type='text'
                      value={source.id}
                      onChange={(e) =>
                        updateSource(index, { id: e.target.value })
                      }
                      placeholder='书源 ID'
                      className='rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
                    />
                    <input
                      type='text'
                      value={source.name}
                      onChange={(e) =>
                        updateSource(index, { name: e.target.value })
                      }
                      placeholder='书源名称'
                      className='rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
                    />
                    <input
                      type='text'
                      value={source.url}
                      onChange={(e) =>
                        updateSource(index, { url: e.target.value })
                      }
                      placeholder='https://example.com/opds'
                      className='rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 md:col-span-2'
                    />
                    <select
                      value={source.authMode || 'none'}
                      onChange={(e) =>
                        updateSource(index, {
                          authMode: e.target.value as BookSource['authMode'],
                        })
                      }
                      className='rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
                    >
                      <option value='none'>无认证</option>
                      <option value='basic'>Basic Auth</option>
                      <option value='header'>自定义 Header</option>
                    </select>
                    <input
                      type='text'
                      value={source.language || ''}
                      onChange={(e) =>
                        updateSource(index, { language: e.target.value })
                      }
                      placeholder='语言 zh / en'
                      className='rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
                    />
                    <input
                      type='text'
                      value={source.searchTemplate || ''}
                      onChange={(e) =>
                        updateSource(index, { searchTemplate: e.target.value })
                      }
                      placeholder='搜索模板 https://...{searchTerms}'
                      className='rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 md:col-span-2'
                    />
                    {source.authMode === 'basic' ? (
                      <>
                        <input
                          type='text'
                          value={source.username || ''}
                          onChange={(e) =>
                            updateSource(index, { username: e.target.value })
                          }
                          placeholder='用户名'
                          className='rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
                        />
                        <input
                          type='password'
                          value={source.password || ''}
                          onChange={(e) =>
                            updateSource(index, { password: e.target.value })
                          }
                          placeholder='密码'
                          className='rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
                        />
                      </>
                    ) : null}
                    {source.authMode === 'header' ? (
                      <>
                        <input
                          type='text'
                          value={source.headerName || ''}
                          onChange={(e) =>
                            updateSource(index, { headerName: e.target.value })
                          }
                          placeholder='Header 名称'
                          className='rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
                        />
                        <input
                          type='password'
                          value={source.headerValue || ''}
                          onChange={(e) =>
                            updateSource(index, { headerValue: e.target.value })
                          }
                          placeholder='Header 值'
                          className='rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
                        />
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className='flex gap-3'>
        <button
          onClick={handleSave}
          disabled={isLoading('saveOPDSConfig')}
          className={buttonStyles.success}
        >
          {isLoading('saveOPDSConfig') ? '保存中...' : '保存电子书源配置'}
        </button>
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
