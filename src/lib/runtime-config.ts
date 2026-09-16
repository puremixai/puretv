export interface RuntimeConfig {
  AI_COMMENTS_ENABLED?: boolean;
  BANGUMI_DATA_SOURCE?: string;
  EMBY_ENABLED?: boolean;
  ENABLE_MOVIE_REQUEST?: boolean;
  FESTIVE_EFFECT_ENABLED?: boolean;
  FLUID_SEARCH?: boolean;
  MUSIC_ENABLED?: boolean;
  MUSIC_PROXY_ENABLED?: boolean;
  OPENLIST_ENABLED?: boolean;
  STORAGE_TYPE?: string;
  SUWAYOMI_ENABLED?: boolean;
  TMDB_IMAGE_BASE_URL?: string;
  VOICE_CHAT_STRATEGY?: string;
  WEB_LIVE_ENABLED?: boolean;
  XIAOYA_ENABLED?: boolean;
  EnableComments?: boolean;
  [key: string]: unknown;
}

export function getRuntimeConfig(): RuntimeConfig {
  if (typeof window === 'undefined') return {};
  return (window as Window & { RUNTIME_CONFIG?: RuntimeConfig }).RUNTIME_CONFIG ?? {};
}
