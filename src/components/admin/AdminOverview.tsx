'use client';

import {
  ArrowRight,
  CheckCircle2,
  FileText,
  Info,
  Radio,
  Video,
} from 'lucide-react';

import type { AdminConfig } from '@/lib/admin.types';

import { AdminSectionId, adminSections } from './navigation';

export function AdminOverview({
  config,
  role,
  onNavigate,
}: {
  config: AdminConfig;
  role: 'owner' | 'admin' | null;
  onNavigate: (id: AdminSectionId) => boolean;
}) {
  const sources = config.SourceConfig || [];
  const subscriptions = config.ConfigSubscriptions || [];
  const failed = subscriptions.filter((item) => item.Enabled && item.LastError);
  const quick: AdminSectionId[] =
    role === 'owner'
      ? [
          'configFile',
          'videoSource',
          'userConfig',
          'siteConfig',
          'liveSource',
          'dataMigration',
        ]
      : [
          'videoSource',
          'userConfig',
          'siteConfig',
          'liveSource',
          'webLive',
          'movieRequests',
        ];
  const stats = [
    {
      label: '启用的视频源',
      value: sources.filter((item) => !item.disabled).length,
      detail: `共 ${sources.length} 个源`,
      icon: Video,
      target: 'videoSource' as const,
    },
    ...(role === 'owner'
      ? [
          {
            label: '配置订阅',
            value: subscriptions.length,
            detail: `${
              subscriptions.filter((item) => item.Enabled && item.AutoUpdate)
                .length
            } 个自动更新`,
            icon: FileText,
            target: 'configFile' as const,
          },
        ]
      : []),
    {
      label: '电视直播源',
      value: (config.LiveConfig || []).filter((item) => !item.disabled).length,
      detail: '已启用的直播源',
      icon: Radio,
      target: 'liveSource' as const,
    },
  ];
  return (
    <div className='space-y-8'>
      <div
        className={`grid gap-4 ${
          stats.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'
        }`}
      >
        {stats.map((item) => (
          <button
            key={item.label}
            onClick={() => onNavigate(item.target)}
            className='group rounded-xl border border-slate-200 bg-white p-5 text-left transition-colors hover:border-emerald-400 dark:border-slate-800 dark:bg-[#111824] dark:hover:border-emerald-700'
          >
            <div className='flex items-center justify-between text-sm text-slate-500'>
              <span>{item.label}</span>
              <item.icon size={18} className='text-slate-400' />
            </div>
            <div className='mt-5 flex items-end justify-between'>
              <div>
                <span className='text-3xl font-semibold tabular-nums'>
                  {item.value}
                </span>
                <p className='mt-2 text-xs text-slate-400'>{item.detail}</p>
              </div>
              <ArrowRight
                size={17}
                className='text-slate-300 transition-transform group-hover:translate-x-1 group-hover:text-emerald-600'
              />
            </div>
          </button>
        ))}
      </div>
      <section>
        <div className='mb-4 flex items-center justify-between'>
          <h2 className='text-base font-semibold'>常用操作</h2>
          <span className='text-xs text-slate-400'>选择一项，直接进入设置</span>
        </div>
        <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
          {quick.map((id) => {
            const item = adminSections.find((section) => section.id === id)!;
            return (
              <button
                key={id}
                onClick={() => onNavigate(id)}
                className='group flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-5 text-left transition-colors hover:border-emerald-400 dark:border-slate-800 dark:bg-[#111824] dark:hover:border-emerald-700'
              >
                <span className='rounded-lg bg-slate-50 p-2.5 text-slate-500 group-hover:bg-emerald-50 group-hover:text-emerald-600 dark:bg-slate-800 dark:group-hover:bg-emerald-950'>
                  <item.icon size={19} />
                </span>
                <span className='min-w-0 flex-1'>
                  <span className='text-sm font-semibold'>{item.title}</span>
                  <span className='mt-1.5 block text-xs leading-5 text-slate-500'>
                    {item.description}
                  </span>
                </span>
                <ArrowRight
                  size={16}
                  className='mt-1 shrink-0 text-slate-300'
                />
              </button>
            );
          })}
        </div>
      </section>
      <section className='overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111824]'>
        <div className='flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800'>
          <h2 className='text-base font-semibold'>配置提示</h2>
          <span className='text-xs text-slate-400'>
            版本 {config.ConfigVersion || 0}
          </span>
        </div>
        <div className='divide-y divide-slate-100 dark:divide-slate-800'>
          {role === 'owner' && failed.length > 0 && (
            <div className='flex flex-wrap items-center gap-3 px-5 py-4'>
              <Info size={18} className='text-amber-500' />
              <div className='min-w-0 flex-1'>
                <p className='text-sm font-medium'>
                  {failed.length} 个订阅更新失败
                </p>
                <p className='mt-1 text-xs text-slate-500'>
                  已保留上次成功内容，可以检查地址后重试。
                </p>
              </div>
              <button
                onClick={() => onNavigate('configFile')}
                className='text-sm font-medium text-emerald-600'
              >
                查看订阅 →
              </button>
            </div>
          )}
          {!config.SiteConfig.TMDBApiKey && (
            <div className='flex flex-wrap items-center gap-3 px-5 py-4'>
              <Info size={18} className='text-slate-400' />
              <div className='min-w-0 flex-1'>
                <p className='text-sm font-medium'>补充影视信息</p>
                <p className='mt-1 text-xs text-slate-500'>
                  设置 TMDB 后可获取更多海报、详情与推荐。
                </p>
              </div>
              <button
                onClick={() => onNavigate('siteConfig')}
                className='text-sm font-medium text-emerald-600'
              >
                前往设置 →
              </button>
            </div>
          )}
          <div className='flex items-start gap-3 px-5 py-4'>
            <CheckCircle2
              size={18}
              className='mt-0.5 shrink-0 text-emerald-600'
            />
            <div>
              <p className='text-sm font-medium'>配置版本保护已启用</p>
              <p className='mt-1 text-xs leading-5 text-slate-500'>
                在各栏目保存更改。遇到版本冲突时会提示重新载入，避免覆盖其他页面的设置。
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
