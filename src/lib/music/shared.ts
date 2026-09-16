import React from 'react';

import type { MusicSource, Song } from '@/lib/music/types';

export interface MusicSongInput {
  id?: string | number;
  songId?: string | number;
  rid?: string | number;
  mid?: string | number;
  source?: string;
  platform?: string;
  vendor?: string;
  origin?: string;
  name?: string;
  title?: string;
  artist?: string;
  singer?: string;
  artists?: string;
  album?: string | { picUrl?: string; pic?: string };
  albumName?: string;
  pic?: string;
  cover?: string;
  img?: string;
  image?: string;
  imageUrl?: string;
  albumPicUrl?: string;
  meta?: { picUrl?: string };
  al?: { picUrl?: string };
  durationSec?: number;
  duration?: number;
  durationText?: string;
  interval?: string;
  songmid?: string;
}

export const musicSources: Array<{ key: MusicSource; label: string }> = [
  { key: 'wy', label: '网易云' },
  { key: 'tx', label: 'QQ' },
  { key: 'kw', label: '酷我' },
  { key: 'kg', label: '酷狗' },
  { key: 'mg', label: '咪咕' },
];

export function normalizeSource(source: string | undefined | null): MusicSource {
  if (source === 'netease') return 'wy';
  if (source === 'qq') return 'tx';
  if (source === 'kuwo') return 'kw';
  if (source === 'wy' || source === 'tx' || source === 'kw' || source === 'kg' || source === 'mg') return source;
  return 'wy';
}

export function mapSong(song: MusicSongInput): Song {
  const rawSource = song.source || song.platform || song.vendor || song.origin;
  const albumObject = typeof song.album === 'object' ? song.album : undefined;
  const pic =
    song.pic ||
    song.cover ||
    song.img ||
    song.image ||
    song.imageUrl ||
    song.albumPicUrl ||
    song.meta?.picUrl ||
    albumObject?.picUrl ||
    albumObject?.pic ||
    song.al?.picUrl;

  return {
    id: String(song.id ?? song.songId ?? song.rid ?? song.mid ?? ''),
    name: song.name || song.title || '未知歌曲',
    artist: song.artist || song.singer || song.artists || '未知艺术家',
    album: (typeof song.album === 'string' ? song.album : undefined) || song.albumName,
    pic,
    platform: normalizeSource(rawSource),
    duration: song.durationSec || song.duration,
    durationText: song.durationText || song.interval,
    songmid: song.songmid || (song.mid !== undefined ? String(song.mid) : undefined),
  };
}

export function getSourceDisplayLabel(source?: MusicSource | string, compact = true): string {
  switch (normalizeSource(source)) {
    case 'wy':
      return compact ? '网易' : '网易云';
    case 'tx':
      return compact ? 'QQ' : 'QQ音乐';
    case 'kw':
      return '酷我';
    case 'kg':
      return '酷狗';
    case 'mg':
      return '咪咕';
  }
}

export function SourcePill({
  source,
  className = '',
  variant = 'subtle',
}: {
  source?: MusicSource | string;
  className?: string;
  variant?: 'subtle' | 'accent';
}) {
  const normalized = normalizeSource(source);
  const label = variant === 'accent'
    ? getSourceDisplayLabel(normalized)
    : musicSources.find((item) => item.key === normalized)?.label || source || '未知';
  const variantClass = variant === 'accent'
    ? 'rounded-lg border-red-500/50 bg-red-500/20 leading-none text-red-400'
    : 'rounded-full border-white/10 bg-white/5 text-zinc-400';

  return React.createElement(
    'span',
    {
      className: `inline-flex shrink-0 items-center border px-2 py-0.5 text-[10px] font-medium ${variantClass} ${className}`,
    },
    label
  );
}
