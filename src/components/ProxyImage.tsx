'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
  clearBangumiImageFallbackCacheIfFailed,
  ensureBangumiImagePrimaryProbed,
  processImageUrl,
  tryApplyBangumiImageFallback,
  tryApplyDoubanImageFallback,
} from '@/lib/utils';

interface ProxyImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  originalSrc: string;
  displaySrc?: string;
  retryDelay?: number;
  retryOnError?: boolean;
}

const ProxyImage: React.FC<ProxyImageProps> = ({
  originalSrc,
  displaySrc,
  retryDelay = 2000,
  retryOnError = true,
  loading = 'lazy',
  decoding = 'async',
  alt = '',
  onError,
  src: _src,
  ...props
}) => {
  const initialSrc = useMemo(
    () => displaySrc || processImageUrl(originalSrc),
    [displaySrc, originalSrc]
  );
  const [currentSrc, setCurrentSrc] = useState(initialSrc);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    setCurrentSrc(initialSrc);
  }, [initialSrc]);

  // 主源图片域主页探测：失败则 sticky 走备源（替代原 5s complete 误判）
  useEffect(() => {
    if (displaySrc) return;

    let cancelled = false;
    void (async () => {
      const reachable = await ensureBangumiImagePrimaryProbed();
      if (cancelled || reachable) return;
      setCurrentSrc(processImageUrl(originalSrc));
    })();

    return () => {
      cancelled = true;
    };
  }, [displaySrc, originalSrc]);

  const handleError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    const img = e.currentTarget;

    if (
      tryApplyDoubanImageFallback(img, originalSrc) ||
      tryApplyBangumiImageFallback(img, originalSrc)
    ) {
      setCurrentSrc(img.src);
      return;
    }

    if (clearBangumiImageFallbackCacheIfFailed(img, originalSrc)) {
      setCurrentSrc(processImageUrl(originalSrc));
      return;
    }

    if (retryOnError && !img.dataset.retried) {
      img.dataset.retried = 'true';
      window.setTimeout(() => {
        setCurrentSrc(initialSrc);
      }, retryDelay);
    }

    onError?.(e);
  };

  return (
    // ProxyImage is the project's custom loader for dynamic proxy and fallback URLs.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...props}
      ref={imgRef}
      src={currentSrc}
      alt={alt}
      loading={loading}
      decoding={decoding}
      onError={handleError}
    />
  );
};

export default ProxyImage;
