'use client';

import type { CSSProperties, ImgHTMLAttributes, SyntheticEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

import './cinematic-artwork.css';

import ProxyImage from '@/components/ProxyImage';

interface CinematicArtworkProps extends ImgHTMLAttributes<HTMLImageElement> {
  originalSrc: string;
  displaySrc?: string;
  active?: boolean;
  paused?: boolean;
}

const FALLBACK_TONE = '#18232e';
const colorCache = new Map<string, string>();

// Sample the image that is already on screen. A tainted canvas is a normal
// fallback: never add a CORS request or delay a visible image to obtain a color.
function imageTone(image: HTMLImageElement): string {
  const source = image.currentSrc || image.src;
  const cached = colorCache.get(source);
  if (cached) {
    colorCache.delete(source);
    colorCache.set(source, cached);
    return cached;
  }

  let tone = FALLBACK_TONE;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 24;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context || !image.naturalWidth) return tone;
    context.drawImage(image, 0, 0, 24, 24);
    const { data } = context.getImageData(0, 0, 24, 24);
    let red = 0;
    let green = 0;
    let blue = 0;
    let weight = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const saturation =
        Math.max(data[i], data[i + 1], data[i + 2]) -
        Math.min(data[i], data[i + 1], data[i + 2]);
      const influence = 1 + saturation / 128;
      red += data[i] * influence;
      green += data[i + 1] * influence;
      blue += data[i + 2] * influence;
      weight += influence;
    }
    if (weight) {
      tone = `rgb(${[red, green, blue]
        .map((channel) => Math.round((channel / weight) * 0.48))
        .join(' ')})`;
    }
  } catch {
    // Remote providers need not allow canvas access for their artwork to work.
  }
  colorCache.set(source, tone);
  if (colorCache.size > 100) colorCache.delete(colorCache.keys().next().value!);
  return tone;
}

function ArtworkFrame({
  active = true,
  paused = false,
  className = '',
  onLoad,
  onError,
  alt = '',
  ...imageProps
}: CinematicArtworkProps) {
  const host = useRef<HTMLDivElement>(null);
  const sampledSource = useRef('');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [tone, setTone] = useState(FALLBACK_TONE);
  const [loadedSource, setLoadedSource] = useState('');
  const [inView, setInView] = useState(true);

  const resolveImage = (image: HTMLImageElement) => {
    const source = image.currentSrc || image.src;
    if (!image.naturalWidth) return;
    setState('ready');
    if (source === sampledSource.current) return;
    sampledSource.current = source;
    setTone(imageTone(image));
    setLoadedSource(source);
  };

  useEffect(() => {
    // Cached SSR images may have finished before React attached load handlers.
    const image = host.current?.querySelector('img');
    if (image?.complete && image.naturalWidth) resolveImage(image);
    if (!host.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      setInView(entry.isIntersecting);
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={host}
      className='cinematic-artwork'
      data-state={state}
      data-active={active}
      data-paused={paused || !inView}
      style={{ '--artwork-tone': tone } as CSSProperties}
    >
      <div
        className='cinematic-artwork-atmosphere'
        aria-hidden='true'
        style={
          loadedSource
            ? {
                backgroundImage: `url(${JSON.stringify(loadedSource)})`,
              }
            : undefined
        }
      />
      <ProxyImage
        {...imageProps}
        alt={alt}
        className={`cinematic-artwork-image ${className}`}
        onLoad={(event: SyntheticEvent<HTMLImageElement>) => {
          resolveImage(event.currentTarget);
          onLoad?.(event);
        }}
        onError={(event: SyntheticEvent<HTMLImageElement>) => {
          setState('error');
          onError?.(event);
        }}
      />
      <div className='cinematic-artwork-wash' aria-hidden='true' />
    </div>
  );
}

export default function CinematicArtwork(props: CinematicArtworkProps) {
  // Replacing the image creates an isolated load cycle. Late events from the
  // previous image cannot make its successor appear ready or overwrite its tone.
  return (
    <ArtworkFrame
      key={`${props.originalSrc}|${props.displaySrc || ''}`}
      {...props}
    />
  );
}
