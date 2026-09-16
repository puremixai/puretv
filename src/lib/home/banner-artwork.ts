import type { BannerData, BannerItem } from '@/lib/home/banner-types';
import {
  type DoubanImageProxyType,
  buildDoubanImageUrl,
  normalizeDoubanImageProxyConfig,
  processImageUrl,
} from '@/lib/utils';

import { getBannerImageProps } from './banner-images';

type Placement = 'hero' | 'poster' | 'thumbnail';
type Artwork = ReturnType<typeof getBannerImageProps> & { displaySrc?: string };
export type InitialBannerArtwork = Record<string, Record<Placement, Artwork>>;
export type BannerImageConfig = {
  tmdbImageBaseUrl: string;
  doubanImageProxyType: DoubanImageProxyType;
  doubanImageProxyUrl: string;
};

export function getBannerArtworkKey(item: BannerItem): string {
  return `${item.media_type}:${item.id}`;
}

export function getBannerArtworkProps(
  item: BannerItem,
  placement: Placement,
  tmdbImageBaseUrl?: string
): Artwork {
  const poster = placement === 'poster';
  const path = poster
    ? item.poster_path || item.backdrop_path
    : item.backdrop_path || item.poster_path;
  const artwork = poster
    ? item.poster_path
      ? 'poster'
      : 'backdrop'
    : item.backdrop_path
    ? 'backdrop'
    : 'poster';
  return getBannerImageProps(path, artwork, placement, tmdbImageBaseUrl);
}

// Serialize the exact SSR URLs so browser-only proxy preferences cannot change hydration.
export function createInitialBannerArtwork(
  data: BannerData,
  imageConfig?: BannerImageConfig
): InitialBannerArtwork {
  const doubanProxy =
    imageConfig &&
    normalizeDoubanImageProxyConfig(
      imageConfig.doubanImageProxyType,
      imageConfig.doubanImageProxyUrl
    );
  return Object.fromEntries(
    data.list.map((item) => [
      getBannerArtworkKey(item),
      Object.fromEntries(
        (['hero', 'poster', 'thumbnail'] as const).map((placement) => {
          const props = getBannerArtworkProps(
            item,
            placement,
            imageConfig?.tmdbImageBaseUrl
          );
          const displaySrc = imageConfig
            ? props.originalSrc.includes('doubanio.com') && doubanProxy
              ? buildDoubanImageUrl(
                  props.originalSrc,
                  doubanProxy.proxyType,
                  doubanProxy.proxyUrl
                )
              : props.originalSrc
            : processImageUrl(props.originalSrc);
          return [placement, { ...props, displaySrc }];
        })
      ),
    ])
  ) as InitialBannerArtwork;
}
