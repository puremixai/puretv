
import { SearchResult } from '@/lib/types';

export interface WakeLockSentinel {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
  removeEventListener(type: 'release', listener: () => void): void;
}

export interface PlayFallbackRecommendation {
  key: string;
  item: SearchResult;
  episodes?: number;
  sourceNames: string[];
  doubanId?: number;
}

export interface SearchCachePayload {
  status: 'complete' | 'partial';
  results: SearchResult[];
  query: string;
  updatedAt: number;
}

export type CustomSubtitleEngine = 'native' | 'jassub';

export type PlaybackSourceBadge = 'local' | 'offline' | null;

export type HarmonyHlsPlaybackMode = 'hlsjs' | 'native';

export type NetdiskHlsPlaybackMode = 'hlsjs' | 'native';

export interface CustomSubtitleState {
  name: string;
  format: string;
  episodeIndex: number;
  engine: CustomSubtitleEngine;
  url?: string;
  content?: string;
}

export interface SourceSubtitleItem {
  label: string;
  url: string;
  fallbackUrl?: string;
  fallbackFormat?: string;
  format?: string;
  sourceFormat?: string;
  codec?: string;
  renderMode?: 'native' | 'jassub';
}

export interface JassubSubtitleInstance {
  setTrack?: (content: string) => void | Promise<void>;
  setTrackByUrl?: (url: string) => void | Promise<void>;
  freeTrack?: () => void | Promise<void>;
  destroy?: () => void | Promise<void>;
}

export const PLAYBACK_RATE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export const HARMONY_HLS_PLAYBACK_MODE_KEY = 'harmony_hls_playback_mode';

export const NETDISK_HLS_PLAYBACK_MODE_KEY = 'netdisk_hls_playback_mode';

export const JASSUB_ASSET_BASE = '/assets/jassub';

export const JASSUB_CJK_FONT_FAMILY = 'noto sans cjk sc';

export const JASSUB_CJK_FONT_URL = `${JASSUB_ASSET_BASE}/NotoSansCJK-Regular.ttc`;

export const ADVANCED_SUBTITLE_FORMATS = new Set(['ass', 'ssa']);

export const isHlsPlaybackUrl = (url: string) =>
  /\.m3u8?(?:$|[/?#])/i.test(url) ||
  url.includes('/api/proxy-m3u8') ||
  url.includes('/api/proxy/vod/m3u8');

export const PLAY_SHORTCUT_GROUPS = [
  {
    title: '播放控制',
    items: [
      { keys: ['空格'], description: '播放 / 暂停' },
      { keys: ['←', '→'], description: '快退 / 快进 10 秒' },
      { keys: ['P'], description: '快捷快进' },
      { keys: ['↑', '↓'], description: '音量增加 / 减少' },
      { keys: ['F'], description: '切换全屏' },
    ],
  },
  {
    title: '剧集切换',
    items: [
      { keys: ['Alt', '←'], description: '上一集' },
      { keys: ['Alt', '→'], description: '下一集' },
    ],
  },
  {
    title: '倍速控制',
    items: [
      { keys: ['小键盘 +'], description: '提高一档倍速' },
      { keys: ['小键盘 -'], description: '降低一档倍速' },
      { keys: ['小键盘 /'], description: '恢复 1x' },
    ],
  },
];
