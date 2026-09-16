'use client';
import { useEffect, useState } from 'react';

import { adminFetch } from '@/lib/admin-fetch';
import { confirmDiscardChanges } from '@/hooks/useUnsavedChanges';

export function ConfigHistory({
  version,
  refreshConfig,
  onRestored,
}: {
  version: number;
  refreshConfig: () => Promise<void>;
  onRestored: () => void;
}) {
  const [history, setHistory] = useState<
    { version: number; savedAt: string }[]
  >([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    adminFetch('/api/admin/config/history')
      .then(async (response) => {
        if (!response.ok) throw new Error('配置历史加载失败');
        const data = await response.json();
        if (active) setHistory(Array.isArray(data.history) ? data.history : []);
      })
      .catch((error) => {
        if (active) setMessage(error.message);
      });
    return () => {
      active = false;
    };
  }, [version]);
  const restore = async (target: number) => {
    if (
      !confirmDiscardChanges() ||
      !window.confirm(
        '恢复版本 ' + target + ' 的全部配置？当前配置会保留在历史中。'
      )
    )
      return;
    setBusy(true);
    setMessage('');
    try {
      const response = await adminFetch('/api/admin/config/history', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-config-version': String(version),
        },
        body: JSON.stringify({ version: target }),
      });
      if (!response.ok)
        throw new Error((await response.json()).error || '恢复失败');
      await refreshConfig();
      onRestored();
      setMessage('已恢复配置，并记录为一个新版本。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '恢复失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className='rounded-lg border border-gray-200 p-4 dark:border-gray-700'>
      <summary className='cursor-pointer font-medium'>
        配置历史 · 当前版本 {version}
      </summary>
      <p className='my-3 text-sm text-gray-500'>
        保留最近 20 个版本，历史总大小上限 8 MiB。恢复会生成新版本。
      </p>
      {message && (
        <p role='status' className='my-2 text-sm'>
          {message}
        </p>
      )}
      {!history.length && (
        <p className='text-sm text-gray-500'>首次保存后将生成历史记录。</p>
      )}
      <ul className='space-y-2'>
        {history.map((item) => (
          <li
            key={item.version}
            className='flex items-center justify-between gap-3 text-sm'
          >
            <span>
              版本 {item.version} ·{' '}
              {new Date(item.savedAt).toLocaleString('zh-CN')}
            </span>
            <button
              disabled={busy}
              onClick={() => void restore(item.version)}
              className='rounded-sm border px-3 py-1 disabled:opacity-50'
            >
              恢复此版本
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
