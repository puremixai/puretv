import type { TMDBItem } from '@/lib/tmdb.client';

export type BannerSource = 'TMDB' | 'TX' | 'Douban';

export interface BannerItem extends Omit<TMDBItem, 'id' | 'video_key'> {
  id: number | string;
  video_key?: string | null;
  subtitle?: string;
  tags?: string[];
  trailer_url?: string | null;
  genres?: string[];
}

export interface BannerData {
  code: 200;
  list: BannerItem[];
  source: BannerSource;
}
