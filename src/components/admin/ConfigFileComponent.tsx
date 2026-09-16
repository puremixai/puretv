'use client';

import { useEffect, useMemo, useState } from 'react';

import type { AdminConfig, ConfigSubscription } from '@/lib/admin.types';
import { adminFetch as fetch } from '@/lib/admin-fetch';
import {
  MAX_CONFIG_SUBSCRIPTIONS,
  mergeSubscriptionConfigs,
  validateSubscriptions,
} from '@/lib/config-subscriptions';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';

import { ConfigHistory } from './ConfigHistory';
import { buttonStyles } from './shared';

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-green-500 focus:ring-green-500 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';

export function ConfigFileComponent({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) {
  const [subscriptions, setSubscriptions] = useState<ConfigSubscription[]>([]);
  const [localContent, setLocalContent] = useState('{}');
  const [busy, setBusy] = useState('');
  const [dirty, setDirty] = useState(false);
  const [draftVersion, setDraftVersion] = useState(0);
  useUnsavedChanges(dirty);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(
    null
  );

  useEffect(() => {
    if (!config || dirty) return;
    setDraftVersion(config.ConfigVersion || 0);
    setSubscriptions(structuredClone(config.ConfigSubscriptions || []));
    setLocalContent(config.ConfigFileLocal || '{}');
    setDirty(false);
  }, [config, dirty]);

  const preview = useMemo(() => {
    try {
      const merged = mergeSubscriptionConfigs(
        localContent,
        subscriptions,
        config?.ConfigFile
      );
      return {
        content: JSON.stringify(merged, null, 2),
        count: Object.keys(merged.api_site || {}).length,
        error: '',
        changes: (() => {
          const previous = JSON.parse(config?.ConfigFile || '{}');
          const changes: string[] = [];
          for (const section of [
            'api_site',
            'lives',
            'custom_category',
          ] as const) {
            const before = previous[section] || {};
            const after = merged[section] || {};
            const label = {
              api_site: '视频源',
              lives: '直播源',
              custom_category: '分类',
            }[section];
            for (const key of Array.from(
              new Set([...Object.keys(before), ...Object.keys(after)])
            )) {
              if (
                JSON.stringify(before[key]) ===
                JSON.stringify((after as Record<string, unknown>)[key])
              )
                continue;
              changes.push(
                label +
                  ' ' +
                  key +
                  '：' +
                  (!(key in before)
                    ? '新增'
                    : !(key in after)
                    ? '移除'
                    : '修改')
              );
            }
          }
          return changes;
        })(),
      };
    } catch (error) {
      return {
        content: '',
        count: 0,
        changes: [] as string[],
        error: error instanceof Error ? error.message : '配置格式无效',
      };
    }
  }, [localContent, subscriptions, config]);

  const update = (id: string, patch: Partial<ConfigSubscription>) => {
    setSubscriptions((current) =>
      current.map((sub) => (sub.ID === id ? { ...sub, ...patch } : sub))
    );
    setDirty(true);
    setNotice(null);
  };

  const add = () => {
    setSubscriptions((current) => [
      ...current,
      {
        ID: crypto.randomUUID(),
        Name: '',
        URL: '',
        Enabled: true,
        AutoUpdate: true,
        LastCheck: '',
        UpdateIntervalHours: 1,
      },
    ]);
    setDirty(true);
    setNotice(null);
  };

  const move = (index: number, offset: number) => {
    setSubscriptions((current) => {
      const next = [...current];
      [next[index], next[index + offset]] = [next[index + offset], next[index]];
      return next;
    });
    setDirty(true);
  };

  const pull = async (id?: string) => {
    setBusy(id || 'all');
    setNotice(null);
    try {
      const list = validateSubscriptions(subscriptions);
      if (preview.error) throw new Error(preview.error);
      const response = await fetch('/api/admin/config_subscription/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscriptions: list,
          configFile: localContent,
          id,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '拉取失败');
      setSubscriptions(data.subscriptions);
      setDirty(true);
      setNotice({
        error: data.failedCount > 0,
        text:
          data.failedCount > 0
            ? `${data.failedCount} 个订阅更新失败，已保留上次成功内容。其余结果已合并，请保存并应用。`
            : `拉取完成，合并后共 ${data.sourceCount} 个视频源。请保存并应用。`,
      });
    } catch (error) {
      setNotice({
        error: true,
        text: error instanceof Error ? error.message : '拉取失败',
      });
    } finally {
      setBusy('');
    }
  };

  const save = async () => {
    setBusy('save');
    setNotice(null);
    try {
      if (preview.error) throw new Error(preview.error);
      const list = validateSubscriptions(subscriptions);
      const response = await fetch('/api/admin/config_file', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-config-version': String(draftVersion),
        },
        body: JSON.stringify({ configFile: localContent, subscriptions: list }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '保存失败');
      await refreshConfig();
      setDirty(false);
      setNotice({ error: false, text: '订阅和配置已保存并应用。' });
    } catch (error) {
      setNotice({
        error: true,
        text: error instanceof Error ? error.message : '保存失败',
      });
    } finally {
      setBusy('');
    }
  };

  const upload = async (file: File) => {
    setBusy('upload');
    try {
      const merged = mergeSubscriptionConfigs(localContent, [
        {
          ID: 'upload',
          Name: file.name,
          URL: '',
          Enabled: true,
          AutoUpdate: false,
          LastCheck: '',
          ConfigContent: await file.text(),
        },
      ]);
      setLocalContent(JSON.stringify(merged, null, 2));
      setDirty(true);
      setNotice({ error: false, text: '文件已合并到手动配置，请保存并应用。' });
    } catch (error) {
      setNotice({
        error: true,
        text: error instanceof Error ? error.message : '上传失败',
      });
    } finally {
      setBusy('');
    }
  };

  if (!config) return <p className='text-gray-500'>加载中...</p>;

  return (
    <div className='space-y-5'>
      <div className='sticky top-16 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-white/95 py-3 backdrop-blur-xs dark:border-slate-800 dark:bg-[#111824]/95'>
        <div>
          <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
            配置订阅
          </h3>
          <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
            {subscriptions.length} 个订阅 · 合并后 {preview.count} 个视频源
            {dirty ? ' · 有未保存的更改' : ''}
          </p>
        </div>
        <div className='flex flex-wrap gap-2'>
          <button
            type='button'
            onClick={add}
            disabled={
              !!busy || subscriptions.length >= MAX_CONFIG_SUBSCRIPTIONS
            }
            className={`${buttonStyles.secondary} disabled:opacity-50`}
          >
            添加订阅
          </button>
          <button
            type='button'
            onClick={() => void pull()}
            disabled={!!busy || !subscriptions.some((sub) => sub.Enabled)}
            className={`${buttonStyles.primary} disabled:opacity-50`}
          >
            {busy === 'all' ? '拉取中…' : '拉取全部'}
          </button>
          <button
            type='button'
            onClick={() => void save()}
            disabled={!!busy}
            className={`${buttonStyles.success} disabled:opacity-50`}
          >
            {busy === 'save' ? '保存中…' : '保存并应用'}
          </button>
        </div>
      </div>
      <p className='text-sm leading-6 text-gray-500 dark:text-gray-400'>
        支持 Base58 或 JSON 订阅。相同 API
        地址自动去重，优先使用手动配置，其次按订阅从上到下的顺序。
        更新失败时保留上次成功内容；停用或删除订阅后，它独有的视频源将在保存时移除。
      </p>
      {notice && (
        <p
          role='status'
          className={`rounded-lg p-3 text-sm ${
            notice.error
              ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
              : 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300'
          }`}
        >
          {notice.text}
        </p>
      )}
      {subscriptions.length === 0 && (
        <div className='rounded-lg border border-dashed border-gray-300 p-8 text-center text-gray-500 dark:border-gray-600'>
          尚未添加订阅，点击“添加订阅”填写地址。
        </div>
      )}
      {dirty && (
        <details
          open
          className='rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950'
        >
          <summary className='cursor-pointer font-medium'>
            应用差异预览 · {preview.changes.length} 项内容变化
          </summary>
          {preview.changes.length ? (
            <ul className='mt-2 max-h-64 list-inside list-disc overflow-auto'>
              {preview.changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          ) : (
            <p className='mt-2'>视频源内容未变化，仅更新订阅设置或检查状态。</p>
          )}
        </details>
      )}
      <fieldset disabled={!!busy} className='space-y-4'>
        <legend className='sr-only'>视频源订阅列表</legend>
        {subscriptions.map((sub, index) => (
          <div
            key={sub.ID}
            className='space-y-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800'
          >
            <div className='grid gap-3 md:grid-cols-[minmax(140px,1fr)_minmax(0,3fr)]'>
              <label className='space-y-1 text-sm text-gray-700 dark:text-gray-300'>
                <span>订阅名称 {index + 1}</span>
                <input
                  aria-label={`订阅名称 ${index + 1}`}
                  className={inputClass}
                  value={sub.Name}
                  placeholder={`订阅 ${index + 1}`}
                  maxLength={100}
                  onChange={(event) =>
                    update(sub.ID, { Name: event.target.value })
                  }
                />
              </label>
              <label className='space-y-1 text-sm text-gray-700 dark:text-gray-300'>
                <span>订阅 URL {index + 1}</span>
                <input
                  aria-label={`订阅 URL ${index + 1}`}
                  type='url'
                  className={inputClass}
                  value={sub.URL}
                  placeholder='https://example.com/config.txt'
                  onChange={(event) =>
                    update(sub.ID, {
                      URL: event.target.value,
                      ConfigContent: undefined,
                      LastCheck: '',
                      LastError: '',
                    })
                  }
                />
              </label>
            </div>
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <div className='flex flex-wrap gap-4 text-sm text-gray-700 dark:text-gray-300'>
                <label className='flex items-center gap-2'>
                  <input
                    type='checkbox'
                    checked={sub.Enabled}
                    onChange={(event) =>
                      update(sub.ID, { Enabled: event.target.checked })
                    }
                  />
                  启用订阅
                </label>
                <label className='flex items-center gap-2'>
                  <input
                    type='checkbox'
                    checked={sub.AutoUpdate}
                    onChange={(event) =>
                      update(sub.ID, { AutoUpdate: event.target.checked })
                    }
                  />
                  自动更新
                </label>
                <label className='flex items-center gap-2'>
                  每
                  <input
                    aria-label={`订阅更新周期 ${index + 1}`}
                    type='number'
                    min={1}
                    max={168}
                    value={sub.UpdateIntervalHours || 1}
                    onChange={(event) =>
                      update(sub.ID, {
                        UpdateIntervalHours: Number(event.target.value),
                      })
                    }
                    className='w-16 rounded-sm border bg-transparent px-2 py-1'
                  />
                  小时更新
                </label>
              </div>
              <div className='flex flex-wrap gap-2'>
                <button
                  type='button'
                  aria-label={`上移订阅 ${index + 1}`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  className={`${buttonStyles.secondarySmall} disabled:opacity-40`}
                >
                  上移
                </button>
                <button
                  type='button'
                  aria-label={`下移订阅 ${index + 1}`}
                  disabled={index === subscriptions.length - 1}
                  onClick={() => move(index, 1)}
                  className={`${buttonStyles.secondarySmall} disabled:opacity-40`}
                >
                  下移
                </button>
                <button
                  type='button'
                  disabled={!sub.Enabled || !sub.URL.trim()}
                  onClick={() => void pull(sub.ID)}
                  className={`${buttonStyles.primarySmall} disabled:opacity-40`}
                >
                  {busy === sub.ID
                    ? '拉取中…'
                    : sub.LastError
                    ? '重试失败订阅'
                    : '单独拉取'}
                </button>
                <button
                  type='button'
                  aria-label={`删除订阅 ${index + 1}`}
                  onClick={() => {
                    setSubscriptions((current) =>
                      current.filter((item) => item.ID !== sub.ID)
                    );
                    setDirty(true);
                  }}
                  className={buttonStyles.dangerSmall}
                >
                  删除
                </button>
              </div>
            </div>
            <p className='text-xs text-gray-500 dark:text-gray-400'>
              上次成功更新：
              {sub.LastCheck
                ? new Date(sub.LastCheck).toLocaleString('zh-CN')
                : '尚未更新'}
              {!sub.ConfigContent && ' · 尚无缓存，请先拉取'}
            </p>
            {sub.LastError && (
              <p className='wrap-break-word text-sm text-red-600 dark:text-red-400'>
                {sub.LastError}
                {sub.ConfigContent ? '（继续使用上次成功内容）' : ''}
              </p>
            )}
          </div>
        ))}
      </fieldset>
      <ConfigHistory
        onRestored={() => setDirty(false)}
        version={config.ConfigVersion || 0}
        refreshConfig={refreshConfig}
      />
      <details className='rounded-lg border border-gray-200 p-4 dark:border-gray-700'>
        <summary className='cursor-pointer font-medium text-gray-800 dark:text-gray-100'>
          手动配置与合并预览
        </summary>
        <div className='mt-4 space-y-4'>
          <label className='block space-y-2 text-sm text-gray-700 dark:text-gray-300'>
            <span>手动配置（JSON，可选，不随订阅更新覆盖）</span>
            <textarea
              aria-label='手动配置'
              value={localContent}
              disabled={!!busy}
              onChange={(event) => {
                setLocalContent(event.target.value);
                setDirty(true);
              }}
              rows={12}
              spellCheck={false}
              className={`${inputClass} font-mono`}
            />
          </label>
          <label className='block space-y-2 text-sm text-gray-700 dark:text-gray-300'>
            <span>导入 JSON 文件到手动配置</span>
            <input
              type='file'
              accept='.json,application/json'
              disabled={!!busy}
              className='block max-w-full text-sm'
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void upload(file);
              }}
            />
          </label>
          {preview.error ? (
            <p role='alert' className='text-sm text-red-600'>
              {preview.error}
            </p>
          ) : (
            <label className='block space-y-2 text-sm text-gray-700 dark:text-gray-300'>
              <span>合并预览（只读）</span>
              <textarea
                aria-label='合并预览'
                value={preview.content}
                readOnly
                rows={12}
                className={`${inputClass} font-mono`}
              />
            </label>
          )}
        </div>
      </details>
    </div>
  );
}
