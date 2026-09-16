'use client';
import { useEffect, useState } from 'react';

import type { AdminConfig } from '@/lib/admin.types';
import { adminFetch } from '@/lib/admin-fetch';
import { effectiveSourceWeight, SourceHealth } from '@/lib/source-health';
export function SourceHealthPanel({
  sources,
  epoch,
}: {
  sources: AdminConfig['SourceConfig'];
  epoch: number;
}) {
  const [health, setHealth] = useState<Record<string, SourceHealth>>({});
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    adminFetch('/api/admin/source/validate')
      .then(async (response) => {
        if (!response.ok) throw new Error('健康记录加载失败');
        const data = await response.json();
        if (active) setHealth(data.health || {});
      })
      .catch((error) => {
        if (active) setMessage(error.message);
      });
    return () => {
      active = false;
    };
  }, [epoch, sources]);
  return (
    <details className='my-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700'>
      <summary className='cursor-pointer font-medium'>视频源健康记录</summary>
      <p className='my-3 text-sm text-gray-500'>
        每 6 小时自动抽检，最多 4 个源并发。连续失败 3
        次起降低搜索优先级，成功后恢复；未匹配到关键词不计为失败。媒体抽检不能保证整部视频均可播放。
      </p>
      {message && <p role='status'>{message}</p>}
      <div className='overflow-x-auto'>
        <table className='w-full text-left text-sm'>
          <thead>
            <tr>
              <th className='p-2'>源</th>
              <th>上次检测</th>
              <th>耗时</th>
              <th>连续失败</th>
              <th>通过/检测</th>
              <th>有效权重</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => {
              const item = health[source.key];
              return (
                <tr key={source.key} className='border-t dark:border-gray-700'>
                  <td className='p-2' title={item?.message}>
                    {source.name}
                    <span className='block text-xs text-gray-500'>
                      {item?.message || '尚未检测'}
                    </span>
                  </td>
                  <td>
                    {item
                      ? new Date(item.checkedAt).toLocaleString('zh-CN')
                      : '—'}
                  </td>
                  <td>{item ? item.latencyMs + 'ms' : '—'}</td>
                  <td>{item?.consecutiveFailures ?? '—'}</td>
                  <td>{item ? item.successes + '/' + item.checks : '—'}</td>
                  <td>{effectiveSourceWeight(source.weight || 0, item)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}
