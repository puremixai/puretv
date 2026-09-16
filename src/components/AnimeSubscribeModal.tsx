'use client';

import { Loader2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { adminFetch as fetch } from '@/lib/admin-fetch';
import {
  type AnimeExcludePreset,
  type AnimeFansubPreset,
  ANIME_EXCLUDE_PRESETS,
  ANIME_FANSUB_PRESETS,
  applyExcludeSingleSelect,
  applyFansubSingleSelect,
  isExcludePresetActive,
  isFansubPresetActive,
} from '@/lib/anime-filter-presets';

import { createCinemaPortal as createPortal } from '@/components/CinemaPortal';

export interface AnimeSubscribeModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 预填番剧名（搜索词） */
  initialTitle: string;
  /** 继续观看时可预填已看集数 */
  initialLastEpisode?: number;
  onSuccess?: () => void;
}

type SourceType = 'acgrip' | 'mikan' | 'dmhy' | 'nyaa';

/**
 * VideoCard / 管理入口共用的「添加追番订阅」轻量弹层（仅 admin API）
 */
export default function AnimeSubscribeModal({
  isOpen,
  onClose,
  initialTitle,
  initialLastEpisode = 0,
  onSuccess,
}: AnimeSubscribeModalProps) {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    title: '',
    filterText: '',
    excludeText: '',
    source: 'mikan' as SourceType,
    lastEpisode: 0,
    enabled: true,
    onePerEpisode: false,
    refillMissingEpisodes: false,
  });

  useEffect(() => {
    if (isOpen) {
      setVisible(true);
      setError('');
      setForm({
        title: initialTitle || '',
        filterText: '',
        excludeText: '',
        source: 'mikan',
        lastEpisode:
          typeof initialLastEpisode === 'number' && initialLastEpisode > 0
            ? initialLastEpisode
            : 0,
        enabled: true,
        onePerEpisode: false,
        refillMissingEpisodes: false,
      });
    } else {
      setVisible(false);
    }
  }, [isOpen, initialTitle, initialLastEpisode]);

  if (!isOpen) return null;

  const chipClass = (active: boolean) =>
    `px-2 py-0.5 text-xs rounded-full border transition-colors ${
      active
        ? 'bg-green-600 text-white border-green-600'
        : 'bg-gray-50 dark:bg-gray-700/60 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-600'
    }`;

  const handleFansubSelect = (preset: AnimeFansubPreset) => {
    setForm((prev) => ({
      ...prev,
      filterText: applyFansubSingleSelect(prev.filterText, preset),
    }));
  };

  const handleExcludeSelect = (preset: AnimeExcludePreset) => {
    setForm((prev) => ({
      ...prev,
      excludeText: applyExcludeSingleSelect(prev.excludeText, preset),
    }));
  };

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.filterText.trim()) {
      setError('番剧名称和过滤关键词不能为空');
      return;
    }
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/admin/anime-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title.trim(),
          filterText: form.filterText.trim(),
          excludeText: form.excludeText.trim(),
          source: form.source,
          enabled: form.enabled,
          lastEpisode: form.lastEpisode,
          onePerEpisode: form.onePerEpisode,
          refillMissingEpisodes: form.refillMissingEpisodes,
        }),
      });
      if (res.status === 403) {
        setError('无权限：仅管理员可添加追番订阅');
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '创建订阅失败');
        return;
      }
      onSuccess?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建订阅失败');
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div className='fixed inset-0 z-10000 flex items-center justify-center p-4'>
      <div
        className={`absolute inset-0 bg-black transition-opacity duration-200 ${
          visible ? 'opacity-50' : 'opacity-0'
        }`}
        onClick={onClose}
      />
      <div
        className={`relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white dark:bg-gray-800 shadow-xl transition-all duration-200 ${
          visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
        }`}
      >
        <div className='sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'>
          <h3 className='text-base font-semibold text-gray-900 dark:text-white'>
            添加追番订阅
          </h3>
          <button
            type='button'
            onClick={onClose}
            className='p-1 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
          >
            <X size={18} />
          </button>
        </div>

        <div className='p-4 space-y-3'>
          <p className='text-xs text-gray-500 dark:text-gray-400'>
            将按番剧名在 ACG 源搜索，过滤后自动离线下载（仅管理员）。
          </p>

          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
              番剧名称 *
            </label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className='w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm'
              placeholder='搜索用的番剧名'
            />
          </div>

          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
              过滤关键词 *
            </label>
            <input
              value={form.filterText}
              onChange={(e) => setForm({ ...form, filterText: e.target.value })}
              className='w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm'
              placeholder='喵萌奶茶屋&简日双语'
            />
            <p className='mt-1 text-[11px] text-gray-400'>字幕组</p>
            <div className='mt-1.5 flex flex-wrap gap-1.5'>
              {ANIME_FANSUB_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type='button'
                  title={p.hint ? `${p.insert}\n${p.hint}` : p.insert}
                  onClick={() => handleFansubSelect(p)}
                  className={chipClass(isFansubPresetActive(form.filterText, p))}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
              排除关键词
            </label>
            <input
              value={form.excludeText}
              onChange={(e) => setForm({ ...form, excludeText: e.target.value })}
              className='w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm'
              placeholder='先行|预告|PV'
            />
            <div className='mt-2 flex flex-wrap gap-1.5'>
              {ANIME_EXCLUDE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type='button'
                  title={p.insert}
                  onClick={() => handleExcludeSelect(p)}
                  className={chipClass(isExcludePresetActive(form.excludeText, p))}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className='grid grid-cols-2 gap-3'>
            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
                搜索源
              </label>
              <select
                value={form.source}
                onChange={(e) =>
                  setForm({ ...form, source: e.target.value as SourceType })
                }
                className='w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm'
              >
                <option value='mikan'>蜜柑</option>
                <option value='acgrip'>ACG.RIP</option>
                <option value='dmhy'>动漫花园</option>
                <option value='nyaa'>Nyaa</option>
              </select>
            </div>
            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
                当前集数
              </label>
              <input
                type='number'
                min={0}
                value={form.lastEpisode}
                onChange={(e) =>
                  setForm({
                    ...form,
                    lastEpisode: parseInt(e.target.value, 10) || 0,
                  })
                }
                className='w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm'
              />
            </div>
          </div>

          <label className='flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300'>
            <input
              type='checkbox'
              checked={form.onePerEpisode}
              onChange={(e) =>
                setForm({ ...form, onePerEpisode: e.target.checked })
              }
              className='rounded-sm border-gray-300'
            />
            单集只下载一次（同集多种子时只入队一条）
          </label>
          <label className='flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300'>
            <input
              type='checkbox'
              checked={form.refillMissingEpisodes}
              onChange={(e) =>
                setForm({ ...form, refillMissingEpisodes: e.target.checked })
              }
              className='rounded-sm border-gray-300'
            />
            缺集重新检索（跳集时按「番名+集数」补搜）
          </label>

          {error ? (
            <p className='text-sm text-red-600 dark:text-red-400'>{error}</p>
          ) : null}

          <div className='flex justify-end gap-2 pt-1'>
            <button
              type='button'
              onClick={onClose}
              disabled={loading}
              className='px-4 py-2 rounded-lg text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'
            >
              取消
            </button>
            <button
              type='button'
              onClick={handleSubmit}
              disabled={loading}
              className='px-4 py-2 rounded-lg text-sm bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 flex items-center gap-2'
            >
              {loading ? <Loader2 size={16} className='animate-spin' /> : null}
              添加订阅
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
