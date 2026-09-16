'use client';

import { ReactNode, useEffect, useState } from 'react';

import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';

/** Guard editable forms when switching sections; search/filter inputs are not drafts. */
export function AdminPanel({
  version,
  children,
}: {
  version: number;
  children: ReactNode;
}) {
  const [edited, setEdited] = useState(false);
  useUnsavedChanges(edited);
  useEffect(() => setEdited(false), [version]);
  return (
    <div
      className='admin-panel min-w-0 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111824] sm:p-6'
      onChangeCapture={(event) => {
        const input = event.target as HTMLInputElement;
        if (
          input.closest('[data-admin-filter]') ||
          input.type === 'search' ||
          input.readOnly ||
          /搜索|筛选|查找/.test(
            (input.placeholder || '') + (input.getAttribute('aria-label') || '')
          )
        )
          return;
        setEdited(true);
      }}
    >
      {edited && (
        <p
          role='status'
          className='mb-5 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200'
        >
          <span className='h-1.5 w-1.5 rounded-full bg-amber-500' />
          有尚未保存的输入，请使用本栏目中的保存按钮。
        </p>
      )}
      {children}
    </div>
  );
}
