'use client';

import {
  ArrowLeft,
  ChevronRight,
  Menu,
  Search,
  Settings2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { ReactNode, useEffect, useRef, useState } from 'react';

import styles from './workspace.module.css';

import { ThemeToggle } from '@/components/ThemeToggle';

import {
  AdminSectionId,
  adminSections,
  filterAdminSections,
  visibleAdminSections,
} from './navigation';

export function AdminWorkspace({
  active,
  role,
  siteName,
  onNavigate,
  children,
}: {
  active: AdminSectionId;
  role: 'owner' | 'admin' | null;
  siteName?: string;
  onNavigate: (id: AdminSectionId) => boolean;
  children: ReactNode;
}) {
  const [query, setQuery] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const desktopSearch = useRef<HTMLInputElement>(null);
  const mobileSearch = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const section = adminSections.find((item) => item.id === active)!;
  const results = filterAdminSections(visibleAdminSections(role), query);

  useEffect(() => {
    dialog.current?.close();
    setQuery('');
  }, [active]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (window.matchMedia('(min-width: 1024px)').matches)
          desktopSearch.current?.focus();
        else {
          dialog.current?.showModal();
          mobileSearch.current?.focus();
        }
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);

  const navigate = (id: AdminSectionId) => {
    if (!onNavigate(id)) return;
    dialog.current?.close();
    setQuery('');
    titleRef.current?.focus({ preventScroll: true });
  };

  const navigation = (mobile = false) => (
    <>
      <div className='flex h-[76px] shrink-0 items-center gap-3 px-5'>
        <span className='flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white'>
          <Settings2 size={19} />
        </span>
        <div className='min-w-0 flex-1'>
          <p className='truncate text-sm font-semibold text-slate-900 dark:text-slate-100'>
            {siteName || 'PureTV'}
          </p>
          <p className='mt-0.5 text-xs text-slate-500'>管理控制台</p>
        </div>
        {mobile && (
          <button
            aria-label='关闭管理导航'
            onClick={() => dialog.current?.close()}
            className='rounded-lg p-2 text-slate-500'
          >
            <X size={18} />
          </button>
        )}
      </div>
      <div className='px-4 pb-4'>
        <div className='relative'>
          <Search
            aria-hidden
            size={15}
            className='pointer-events-none absolute left-3 top-3 text-slate-400'
          />
          <input
            ref={mobile ? mobileSearch : desktopSearch}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            type='search'
            aria-label='搜索管理功能'
            placeholder='搜索功能…'
            className='h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-hidden focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-900'
          />
        </div>
        <p className='mt-2 text-[11px] text-slate-400'>Ctrl / ⌘ K 快速查找</p>
      </div>
      <nav
        aria-label='管理功能'
        className='min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-5'
      >
        {Array.from(new Set(results.map((item) => item.group))).map((group) => (
          <div key={group} className='mb-5'>
            <p className='mb-2 px-3 text-[11px] font-medium tracking-wider text-slate-400 dark:text-slate-500'>
              {group}
            </p>
            <div className='space-y-0.5'>
              {results
                .filter((item) => item.group === group)
                .map((item) => (
                  <button
                    key={item.id}
                    onClick={() => navigate(item.id)}
                    aria-current={item.id === active ? 'page' : undefined}
                    className={`flex min-h-10 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${
                      active === item.id
                        ? 'bg-emerald-50 font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                    }`}
                  >
                    <item.icon size={16} strokeWidth={1.8} aria-hidden />
                    <span className='flex-1'>{item.title}</span>
                    {active === item.id && (
                      <span className='h-1.5 w-1.5 rounded-full bg-emerald-500' />
                    )}
                  </button>
                ))}
            </div>
          </div>
        ))}
        {!results.length && (
          <div
            role='status'
            className='px-3 py-8 text-center text-sm text-slate-500'
          >
            <p>没有找到相关功能</p>
            <button
              onClick={() => setQuery('')}
              className='mt-3 font-medium text-emerald-600'
            >
              清除搜索
            </button>
          </div>
        )}
      </nav>
      <div className='flex shrink-0 items-center gap-3 border-t border-slate-200 px-4 py-3 dark:border-slate-800'>
        <ThemeToggle />
        <Link
          href='/'
          className='flex items-center gap-2 text-sm text-slate-500 hover:text-emerald-600'
        >
          <ArrowLeft size={16} />
          返回观影
        </Link>
      </div>
    </>
  );

  return (
    <div
      className={`${styles.workspace} min-h-screen bg-[#f5f7f9] text-slate-900 dark:bg-[#0d121b] dark:text-slate-100`}
    >
      <a
        href='#admin-content'
        className='sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-100 focus:rounded-lg focus:bg-white focus:p-3'
      >
        跳转到配置内容
      </a>
      <aside className='fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111824] lg:flex'>
        {navigation()}
      </aside>
      <dialog
        ref={dialog}
        aria-label='管理导航'
        className='fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-[min(320px,88vw)] max-w-none border-r border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-[#111824] dark:text-slate-100'
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        <div className='flex h-full flex-col'>{navigation(true)}</div>
      </dialog>
      <div className='min-w-0 lg:pl-60'>
        <header className='sticky top-0 z-20 flex min-h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur-xs dark:border-slate-800 dark:bg-[#111824]/95 sm:px-8'>
          <div className='flex min-w-0 items-center gap-3'>
            <button
              onClick={() => dialog.current?.showModal()}
              aria-label='打开管理导航'
              className='rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden'
            >
              <Menu size={20} />
            </button>
            <div className='flex min-w-0 items-center gap-2 text-sm text-slate-400'>
              <span className='hidden sm:inline'>管理控制台</span>
              <ChevronRight size={14} className='hidden sm:block' />
              <span className='truncate font-medium text-slate-700 dark:text-slate-200'>
                {section.title}
              </span>
            </div>
          </div>
          <div className='flex shrink-0 items-center gap-3'>
            <span className='rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 dark:border-slate-700'>
              {role === 'owner'
                ? '站长'
                : role === 'admin'
                ? '管理员'
                : '载入中'}
            </span>
          </div>
        </header>
        <main
          id='admin-content'
          className='mx-auto w-full max-w-[1600px] px-4 pb-12 pt-6 sm:px-8 sm:pt-8'
        >
          <div className='mb-6'>
            <h1
              ref={titleRef}
              tabIndex={-1}
              className='text-2xl font-semibold tracking-tight outline-hidden sm:text-[28px]'
            >
              {section.title}
            </h1>
            <p className='mt-2 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400'>
              {section.description}
            </p>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
