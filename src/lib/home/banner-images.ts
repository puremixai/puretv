import { getTMDBImageUrl } from '@/lib/tmdb-image-base';

type ArtworkType = 'backdrop' | 'poster';
type ImagePlacement = 'hero' | 'poster' | 'thumbnail';

const imageWidths = {
  backdrop: { hero: [780, 1280], thumbnail: [300, 780] },
  poster: { hero: [342, 500, 780], thumbnail: [92, 185, 342] },
};

/** Only TMDB paths have known resize variants; external URLs keep proxy fallback. */
export function getBannerImageProps(
  path: string | null | undefined,
  artwork: ArtworkType,
  placement: ImagePlacement,
  tmdbImageBaseUrl?: string
): { originalSrc: string; srcSet?: string; sizes?: string } {
  if (!path || /^https?:\/\//i.test(path)) {
    return { originalSrc: path || '' };
  }

  const thumbnail = placement === 'thumbnail';
  const widths = imageWidths[artwork][thumbnail ? 'thumbnail' : 'hero'];
  const defaultWidth = thumbnail
    ? artwork === 'backdrop'
      ? 300
      : 185
    : placement === 'poster'
    ? artwork === 'backdrop'
      ? 780
      : 500
    : widths[widths.length - 1];
  const imageUrl = (width: number) =>
    tmdbImageBaseUrl
      ? `${tmdbImageBaseUrl.replace(/\/+$/, '')}/t/p/w${width}${path}`
      : getTMDBImageUrl(path, `w${width}`);

  return {
    originalSrc: imageUrl(defaultWidth),
    srcSet: widths.map((width) => `${imageUrl(width)} ${width}w`).join(', '),
    sizes: thumbnail
      ? '50px'
      : placement === 'poster'
      ? '(max-width: 767px) 207px, 360px'
      : '100vw',
  };
}
