'use client';

import { Images, Pause, Play, Star } from 'lucide-react';
import { type RefObject, useRef, useState } from 'react';

import './detail-hero.css';

import CinematicArtwork from '@/components/hero/CinematicArtwork';
import { useHeroParallax } from '@/components/hero/useHeroParallax';
import ProxyImage from '@/components/ProxyImage';

interface DetailHeroProps {
  title: string;
  poster?: string;
  backdrop?: string;
  year?: string;
  rating?: number;
  compact?: boolean;
  active?: boolean;
  paused?: boolean;
  scrollRef?: RefObject<HTMLElement | null>;
  onImageClick?: (image: string) => void;
}

function DetailHeroFrame({
  title,
  poster,
  backdrop,
  year,
  rating,
  compact = false,
  active = true,
  paused = false,
  scrollRef,
  onImageClick,
}: DetailHeroProps) {
  const host = useRef<HTMLElement>(null);
  const [backdropFailed, setBackdropFailed] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const hasBackdrop = !!backdrop && backdrop !== poster && !backdropFailed;
  const artwork = hasBackdrop ? backdrop : posterFailed ? undefined : poster;
  const portrait = !hasBackdrop && !!artwork;
  const motionPaused = paused || userPaused || !active;

  useHeroParallax(host, {
    enabled: !!artwork && !motionPaused,
    scrollRef,
  });

  return (
    <section
      ref={host}
      className='detail-hero'
      aria-label={`${title} 影片预览`}
      data-portrait={portrait}
      data-compact={compact}
      data-paused={motionPaused}
    >
      {artwork && (
        <CinematicArtwork
          key={artwork}
          originalSrc={artwork}
          alt={`${title} 背景`}
          className='detail-hero__image'
          active={active}
          paused={motionPaused}
          loading='eager'
          fetchPriority='high'
          onError={() =>
            hasBackdrop ? setBackdropFailed(true) : setPosterFailed(true)
          }
        />
      )}
      <div className='detail-hero__shade' aria-hidden='true' />
      {hasBackdrop && poster && onImageClick && (
        <button
          type='button'
          className='detail-hero__open-poster'
          aria-label={`查看${title}海报`}
          onClick={() => onImageClick(poster)}
        >
          <Images size={14} />
          查看海报
        </button>
      )}
      {artwork && (
        <button
          type='button'
          className='detail-hero__motion'
          aria-label={userPaused ? '继续动态效果' : '暂停动态效果'}
          aria-pressed={userPaused}
          disabled={paused || !active}
          onClick={() => setUserPaused((value) => !value)}
        >
          {userPaused ? <Play size={15} /> : <Pause size={15} />}
        </button>
      )}
      <div className='detail-hero__content'>
        {portrait && poster && !posterFailed && (
          <button
            type='button'
            className='detail-hero__poster'
            aria-label={`查看${title}海报`}
            onClick={() => onImageClick?.(poster)}
            disabled={!onImageClick}
          >
            <ProxyImage
              originalSrc={poster}
              alt={`${title} 海报`}
              loading='eager'
              retryOnError={false}
              draggable={false}
              onError={() => setPosterFailed(true)}
            />
          </button>
        )}
        <div className='detail-hero__copy'>
          <h3 className='detail-hero__title'>{title}</h3>
          {(year || (typeof rating === 'number' && rating > 0)) && (
            <div className='detail-hero__metadata'>
              {year && <span>{year}</span>}
              {typeof rating === 'number' && rating > 0 && (
                <span
                  className='detail-hero__rating'
                  aria-label={`评分 ${rating.toFixed(1)}`}
                >
                  <Star size={14} fill='currentColor' aria-hidden='true' />
                  <span>{rating.toFixed(1)}</span>
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default function DetailHero(props: DetailHeroProps) {
  return (
    <DetailHeroFrame
      key={`${props.title}|${props.backdrop || ''}|${props.poster || ''}`}
      {...props}
    />
  );
}
