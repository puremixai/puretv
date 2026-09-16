'use client';

import { useEffect, useRef } from 'react';

export function UnsavedChangesDialog({
  open,
  onCancel,
  onDiscard,
}: {
  open: boolean;
  onCancel: () => void;
  onDiscard: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onCancel={onCancel}
      aria-labelledby='unsaved-title'
      className='fixed m-auto w-[calc(100vw-2rem)] max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-xl backdrop:bg-slate-950/50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'
    >
      <h2 id='unsaved-title' className='text-lg font-semibold'>
        更改还未保存
      </h2>
      <p className='mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400'>
        切换栏目会丢失当前输入。你可以继续编辑并保存，或放弃这些更改。
      </p>
      <div className='mt-6 flex flex-wrap justify-end gap-3'>
        <button
          autoFocus
          onClick={onCancel}
          className='rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium dark:border-slate-600'
        >
          继续编辑
        </button>
        <button
          onClick={onDiscard}
          className='rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700'
        >
          放弃并切换
        </button>
      </div>
    </dialog>
  );
}
