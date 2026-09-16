'use client';

import {
  ChevronLeft,
  ChevronRight,
  Film,
  Info,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { getDoubanDetail } from '@/lib/douban.client';
import {
  type InitialBannerArtwork,
  getBannerArtworkKey,
  getBannerArtworkProps,
} from '@/lib/home/banner-artwork';
import type { BannerData, BannerItem } from '@/lib/home/banner-types';
import { logger } from '@/lib/logger';
import { getGenreNames } from '@/lib/tmdb.client';

import CinematicArtwork from '@/components/hero/CinematicArtwork';
import { useHeroParallax } from '@/components/hero/useHeroParallax';
import ProxyImage from '@/components/ProxyImage';

const DetailPanel = dynamic(() => import('@/components/DetailPanel'), {
  ssr: false,
});

interface BannerCarouselProps {
  initialArtwork?: InitialBannerArtwork;
  initialData?: BannerData | null;
  autoPlayInterval?: number; // 自动播放间隔（毫秒）
  delayLoad?: boolean; // 是否延迟加载（等页面加载完毕后再加载）
}

type HomeBannerHeightScale = '1' | '1.5' | '2';
const LOCALSTORAGE_DURATION = 24 * 60 * 60 * 1000;
const subscribeToClientState = () => () => undefined;

const getSavedBannerHeightScale = (): HomeBannerHeightScale => {
  if (typeof window === 'undefined') return '1';

  const saved = localStorage.getItem('homeBannerHeightScale');
  return saved === '1.5' || saved === '2' ? saved : '1';
};

export default function BannerCarousel({
  initialData,
  initialArtwork,
  autoPlayInterval = 5000,
  delayLoad = false,
}: BannerCarouselProps) {
  const router = useRouter();
  const imagesReady = useSyncExternalStore(
    subscribeToClientState,
    () => true,
    () => false
  );
  const artworkFor = (
    item: BannerItem,
    placement: 'hero' | 'poster' | 'thumbnail',
  ) =>
    (!imagesReady &&
      initialArtwork?.[getBannerArtworkKey(item)]?.[placement]) ||
    getBannerArtworkProps(item, placement);
  const [items, setItems] = useState<BannerItem[]>(initialData?.list || []);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(!initialData);
  const [shouldLoad, setShouldLoad] = useState(!delayLoad); // 是否应该开始加载数据
  const [autoPlayReset, setAutoPlayReset] = useState(0);
  const [isYouTubeAccessible, setIsYouTubeAccessible] = useState(false); // YouTube连通性（默认false，检查后再决定）
  const [enableTrailers, setEnableTrailers] = useState(false); // 是否启用预告片（默认关闭）
  const [dataSource, setDataSource] = useState<string>(
    initialData?.source || '',
  ); // 当前数据源
  const [trailersLoaded, setTrailersLoaded] = useState(false); // 预告片是否已加载
  const [isMuted, setIsMuted] = useState(true); // 视频是否静音（默认静音）
  const [bannerHeightScale, setBannerHeightScale] =
    useState<HomeBannerHeightScale>('1'); // 轮播图高度倍率
  const [rotationEnabled, setRotationEnabled] = useState<boolean | null>(null);
  const [isFocusWithin, setIsFocusWithin] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [detailItem, setDetailItem] = useState<BannerItem | null>(null);
  const [detailSource, setDetailSource] = useState('');
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const heroRef = useRef<HTMLElement>(null);
  const pickerRef = useRef<HTMLElement>(null);
  useHeroParallax(heroRef, {
    enabled:
      shouldLoad &&
      !isLoading &&
      items.length > 0 &&
      !reducedMotion &&
      !isDetailOpen,
  });
  const rotationPaused = !(rotationEnabled ?? !reducedMotion);
  const [portraitArtwork, setPortraitArtwork] = useState<
    Record<string, boolean>
  >({});
  const videoRefs = useRef<Map<number, HTMLVideoElement>>(new Map());
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);
  const isManualChange = useRef(false); // 标记是否为手动切换
  const keyboardNavigation = useRef(false);
  const manualChangeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 根据数据源获取缓存key
  const getLocalStorageKey = (source: string) => {
    return `banner_trending_cache_${source}`;
  };

  // 跳转到播放页面
  const handlePlay = (title: string) => {
    router.push(`/play?title=${encodeURIComponent(title)}`);
  };

  // 切换音量
  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newMutedState = !isMuted;
    setIsMuted(newMutedState);

    // 直接更新当前视频元素的静音状态
    const currentVideo = videoRefs.current.get(currentIndex);
    if (currentVideo) {
      currentVideo.muted = newMutedState;
    }
  };

  // 获取视频URL（处理豆瓣视频代理）
  const getVideoUrl = (url: string | null) => {
    if (!url) return null;
    // 豆瓣视频直接使用服务器代理
    if (url.includes('doubanio.com')) {
      return `/api/video-proxy?url=${encodeURIComponent(url)}`;
    }
    return url;
  };

  // 读取本地设置
  useEffect(() => {
    const setting = localStorage.getItem('enableTrailers');
    if (setting !== null) {
      setEnableTrailers(setting === 'true');
    }

    setBannerHeightScale(getSavedBannerHeightScale());

    const handleHomeModulesUpdated = () => {
      setBannerHeightScale(getSavedBannerHeightScale());
    };

    window.addEventListener('homeModulesUpdated', handleHomeModulesUpdated);
    return () => {
      window.removeEventListener(
        'homeModulesUpdated',
        handleHomeModulesUpdated,
      );
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => setReducedMotion(media.matches);
    const updateVisibility = () => setPageVisible(!document.hidden);
    updateMotion();
    updateVisibility();
    media.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      media.removeEventListener('change', updateMotion);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);

  // Pointer clicks can keep focus on a slide control; only keyboard focus pauses rotation.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') keyboardNavigation.current = true;
    };
    const handlePointerDown = () => {
      keyboardNavigation.current = false;
      setIsFocusWithin(false);
    };
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      if (manualChangeTimer.current !== null) {
        clearTimeout(manualChangeTimer.current);
      }
    };
  }, []);

  // 延迟加载：等待页面加载完毕后再开始加载轮播图数据
  useEffect(() => {
    if (!delayLoad) return;

    // 页面加载完毕后再开始加载
    if (document.readyState === 'complete') {
      setShouldLoad(true);
    } else {
      const handleLoad = () => {
        setShouldLoad(true);
      };
      window.addEventListener('load', handleLoad);
      return () => window.removeEventListener('load', handleLoad);
    }
  }, [delayLoad]);

  // 检测YouTube连通性 - 仅在启用预告片且数据源为TMDB时检测
  useEffect(() => {
    // 如果未启用预告片或数据源不是TMDB，不进行检测
    if (!enableTrailers || dataSource !== 'TMDB') {
      setIsYouTubeAccessible(false);
      return;
    }

    const checkYouTubeAccess = () => {
      const img = document.createElement('img');
      const timeout = setTimeout(() => {
        img.src = '';
        setIsYouTubeAccessible(false);
      }, 3000);

      img.onload = () => {
        clearTimeout(timeout);
        setIsYouTubeAccessible(true);
      };

      img.onerror = () => {
        clearTimeout(timeout);
        setIsYouTubeAccessible(false);
      };

      // 添加随机查询参数避免缓存
      img.src = `https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg?t=${Date.now()}`;
    };

    checkYouTubeAccess();
  }, [enableTrailers, dataSource]);

  // 获取热门内容
  useEffect(() => {
    // The server seed is newer than browser caches and already contains the first artwork.
    if (initialData) {
      setItems(initialData.list);
      setCurrentIndex(0);
      setDataSource(initialData.source);
      setTrailersLoaded(false);
      setIsLoading(false);
      return;
    }
    // 如果不应该加载，直接返回
    if (!shouldLoad) return;
    const controller = new AbortController();
    let cancelled = false;

    const fetchTrending = async () => {
      try {
        // 先尝试从所有可能的数据源缓存中读取，找到最新的缓存
        const sources = ['TMDB', 'TX', 'Douban'];
        let cachedData = null;
        let validSource = null;
        let cacheExpired = false;
        let latestTimestamp = 0;

        // 遍历所有数据源，找到最新的缓存
        for (const source of sources) {
          const cacheKey = getLocalStorageKey(source);
          const cached = localStorage.getItem(cacheKey);

          if (cached) {
            try {
              const { data, timestamp } = JSON.parse(cached);

              // 选择时间戳最新的缓存
              if (timestamp > latestTimestamp) {
                cachedData = data;
                validSource = source;
                latestTimestamp = timestamp;
                cacheExpired = Date.now() - timestamp > LOCALSTORAGE_DURATION;
              }
            } catch (e) {
              logger.error('解析缓存数据失败:', e);
            }
          }
        }

        // 乐观缓存：如果有缓存（无论是否过期），先显示缓存数据
        if (cachedData) {
          setItems(cachedData);
          setCurrentIndex(0);
          setDataSource(validSource || ''); // 设置数据源
          setIsLoading(false);
          setTrailersLoaded(false); // 重置预告片加载状态
        }

        // 如果缓存过期或没有缓存，后台更新数据
        if (!cachedData || cacheExpired) {
          const response = await fetch('/api/tmdb/trending', {
            signal: controller.signal,
          });
          const result = await response.json();
          if (cancelled) return;

          if (result.code === 200 && result.list.length > 0) {
            const newDataSource = result.source || 'TMDB'; // 获取数据源标识
            const cacheKey = getLocalStorageKey(newDataSource);

            setItems(result.list);
            setCurrentIndex(0);
            setDataSource(newDataSource); // 设置数据源
            setTrailersLoaded(false); // 重置预告片加载状态

            // 保存到 localStorage（使用数据源特定的key）
            try {
              localStorage.setItem(
                cacheKey,
                JSON.stringify({
                  data: result.list,
                  timestamp: Date.now(),
                }),
              );
            } catch (e) {
              // localStorage 可能已满，忽略错误
              logger.error('保存到 localStorage 失败:', e);
            }
          }
        }
      } catch (error) {
        if (!cancelled) logger.error('获取热门内容失败:', error);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchTrending();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [shouldLoad, initialData]);

  // 前端获取豆瓣预告片
  useEffect(() => {
    // 只有在启用预告片、数据源是豆瓣、有数据且未加载预告片时才执行
    if (
      !enableTrailers ||
      dataSource !== 'Douban' ||
      items.length === 0 ||
      trailersLoaded
    ) {
      return;
    }

    let cancelled = false;
    const fetchDoubanTrailers = async () => {
      try {
        // 为每个项目获取预告片
        const itemsWithTrailers = await Promise.all(
          items.map(async (item) => {
            try {
              // 使用统一的豆瓣详情获取函数（会根据用户配置的代理设置自动选择请求方式）
              const detail = await getDoubanDetail(item.id.toString());

              // 获取预告片链接（取第一个）
              const trailerUrl =
                detail.trailers && detail.trailers.length > 0
                  ? detail.trailers[0].video_url
                  : null;

              return {
                ...item,
                trailer_url: trailerUrl,
              };
            } catch (error) {
              if (!cancelled)
                logger.error(`获取豆瓣电影 ${item.id} 预告片失败:`, error);
              return item;
            }
          }),
        );

        if (cancelled) return;
        const trailersByItem = new Map(
          itemsWithTrailers.map((item) => [
            getBannerArtworkKey(item),
            item.trailer_url,
          ]),
        );
        setItems((currentItems) =>
          currentItems.map((item) =>
            trailersByItem.has(getBannerArtworkKey(item))
              ? {
                  ...item,
                  trailer_url: trailersByItem.get(getBannerArtworkKey(item)),
                }
              : item,
          ),
        );
        setTrailersLoaded(true);
      } catch (error) {
        if (!cancelled) logger.error('获取豆瓣预告片失败:', error);
      }
    };

    fetchDoubanTrailers();
    return () => {
      cancelled = true;
    };
  }, [enableTrailers, dataSource, items, trailersLoaded]);

  // 切换轮播图时重置静音状态
  useEffect(() => {
    setIsMuted(true);
  }, [currentIndex]);

  // 控制视频播放/暂停和静音状态
  useEffect(() => {
    // 遍历所有视频元素
    videoRefs.current.forEach((video, index) => {
      if (index === currentIndex) {
        // 当前显示的视频：播放并设置静音状态
        video.muted = isMuted;
        video.play().catch(() => {
          // 忽略自动播放失败的错误
        });
      } else {
        // 非当前显示的视频：暂停
        video.pause();
      }
    });
  }, [currentIndex, isMuted]);

  // 自动播放
  useEffect(() => {
    if (
      items.length < 2 ||
      rotationPaused ||
      isFocusWithin ||
      !pageVisible ||
      isDetailOpen
    )
      return;

    const timer = setTimeout(() => {
      setCurrentIndex((prev) => (prev + 1) % items.length);
    }, autoPlayInterval);

    return () => clearTimeout(timer);
  }, [
    items.length,
    currentIndex,
    rotationPaused,
    isFocusWithin,
    pageVisible,
    autoPlayInterval,
    autoPlayReset,
    isDetailOpen,
  ]);

  useEffect(() => {
    const picker = pickerRef.current;
    const selected = picker?.querySelector<HTMLElement>(
      '[aria-pressed="true"]',
    );
    if (!picker || !selected) return;
    const left = selected.offsetLeft - picker.offsetLeft;
    if (
      left < picker.scrollLeft ||
      left + selected.offsetWidth > picker.scrollLeft + picker.clientWidth
    ) {
      picker.scrollTo?.({
        left: Math.max(
          0,
          left - (picker.clientWidth - selected.offsetWidth) / 2,
        ),
        behavior: reducedMotion ? 'instant' : 'smooth',
      });
    }
  }, [currentIndex, reducedMotion]);

  const markManualChange = useCallback(() => {
    isManualChange.current = true;
    setAutoPlayReset((value) => value + 1);
    if (manualChangeTimer.current !== null) {
      clearTimeout(manualChangeTimer.current);
    }
    manualChangeTimer.current = setTimeout(() => {
      isManualChange.current = false;
      manualChangeTimer.current = null;
    }, 100);
  }, []);

  const goToPrevious = useCallback(() => {
    markManualChange();
    setCurrentIndex((prev) => (prev - 1 + items.length) % items.length);
  }, [items.length, markManualChange]);

  const goToNext = useCallback(() => {
    markManualChange();
    setCurrentIndex((prev) => (prev + 1) % items.length);
  }, [items.length, markManualChange]);

  const goToSlide = useCallback(
    (index: number) => {
      markManualChange();
      setCurrentIndex(index);
    },
    [markManualChange],
  );

  const toggleRotation = () => {
    setRotationEnabled(rotationPaused);
    if (rotationPaused) setIsFocusWithin(false);
  };

  // 触摸事件处理
  const handleTouchStart = (e: React.TouchEvent) => {
    // 防止在手动切换过程中触发
    if (isManualChange.current) return;
    touchStartX.current = e.touches[0].clientX;
    touchEndX.current = 0; // 重置结束位置
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    // 防止在手动切换过程中触发
    if (isManualChange.current) return;
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    // 防止在手动切换过程中触发
    if (isManualChange.current) return;
    if (!touchStartX.current) return;

    // 如果有滑动，则执行滑动逻辑
    if (touchEndX.current !== 0) {
      const distance = touchStartX.current - touchEndX.current;
      const minSwipeDistance = 50; // 最小滑动距离

      if (Math.abs(distance) > minSwipeDistance) {
        if (distance > 0) {
          // 向左滑动，显示下一张
          goToNext();
        } else {
          // 向右滑动，显示上一张
          goToPrevious();
        }
      }
    }

    // 重置
    touchStartX.current = 0;
    touchEndX.current = 0;
  };

  if (isLoading || !shouldLoad) {
    return (
      <section
        className='cinema-hero cinema-hero-loading'
        data-height={bannerHeightScale}
        aria-label='正在加载精选推荐'
        aria-busy='true'
      >
        <div className='cinema-hero-loading-mark'>
          <Film size={34} strokeWidth={1} />
          <span>精彩，即将开场</span>
        </div>
      </section>
    );
  }

  if (!items.length) {
    return (
      <section className='cinema-hero cinema-hero-empty'>
        <div className='cinema-hero-copy'>
          <p className='cinema-eyebrow'>你的私人影院</p>
          <h1>
            下一部好故事，
            <br />
            就在这里。
          </h1>
          <p className='cinema-synopsis'>
            搜索你想看的电影与剧集，开启今晚的观影时光。
          </p>
          <button
            className='cinema-primary'
            onClick={() => router.push('/search')}
          >
            <Play size={17} fill='currentColor' />
            探索影片
          </button>
        </div>
      </section>
    );
  }

  const currentItem = items[currentIndex] || items[0];
  const genres = currentItem.tags?.length
    ? currentItem.tags
    : currentItem.genres?.length
      ? currentItem.genres
      : getGenreNames(currentItem.genre_ids, 3);
  const showTrailer =
    enableTrailers && !reducedMotion && pageVisible && !isDetailOpen;
  const renderingTrailer =
    showTrailer &&
    Boolean(
      currentItem.trailer_url || (currentItem.video_key && isYouTubeAccessible),
    );
  const showPoster =
    portraitArtwork[getBannerArtworkKey(currentItem)] ??
    currentItem.backdrop_path === currentItem.poster_path;

  return (
    <>
      <section
        ref={heroRef}
        className='cinema-hero'
        data-height={bannerHeightScale}
        data-poster={showPoster && !renderingTrailer}
        data-rotating={
          !rotationPaused && !isFocusWithin && pageVisible && !isDetailOpen
        }
        style={
          {
            '--cinema-rotation-duration': `${autoPlayInterval}ms`,
          } as CSSProperties
        }
        aria-roledescription='轮播图'
        aria-label='精选推荐'
        onFocusCapture={() => setIsFocusWithin(keyboardNavigation.current)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setIsFocusWithin(false);
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className='cinema-hero-media' aria-hidden='true'>
          {items.map((item, index) => {
            const active = index === currentIndex;
            if (
              !active &&
              index !== (currentIndex + 1) % items.length &&
              index !== (currentIndex - 1 + items.length) % items.length
            )
              return null;
            return (
              <div
                key={getBannerArtworkKey(item)}
                className='cinema-hero-slide'
                data-active={active}
              >
                <CinematicArtwork
                  {...artworkFor(item, 'hero')}
                  alt=''
                  className='cinema-backdrop'
                  active={active}
                  paused={rotationPaused || !pageVisible || isDetailOpen}
                  loading={active ? 'eager' : 'lazy'}
                  fetchPriority={active ? 'high' : 'low'}
                  onLoad={(event) => {
                    const image = event.currentTarget;
                    const portrait =
                      image.naturalWidth / image.naturalHeight < 1.35;
                    setPortraitArtwork((previous) =>
                      previous[getBannerArtworkKey(item)] === portrait
                        ? previous
                        : {
                            ...previous,
                            [getBannerArtworkKey(item)]: portrait,
                          },
                    );
                  }}
                />
                {active && item.trailer_url && showTrailer ? (
                  <video
                    ref={(element) => {
                      if (element) videoRefs.current.set(index, element);
                      else videoRefs.current.delete(index);
                    }}
                    src={getVideoUrl(item.trailer_url) || undefined}
                    className='cinema-backdrop cinema-trailer'
                    autoPlay
                    muted={isMuted}
                    loop
                    playsInline
                    preload='metadata'
                  />
                ) : active &&
                  item.video_key &&
                  isYouTubeAccessible &&
                  showTrailer ? (
                  <iframe
                    title={item.title + '预告片'}
                    src={
                      'https://www.youtube.com/embed/' +
                      item.video_key +
                      '?autoplay=1&mute=1&controls=0&loop=1&playlist=' +
                      item.video_key +
                      '&rel=0'
                    }
                    className='cinema-trailer-frame'
                    allow='autoplay; encrypted-media'
                    tabIndex={-1}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
        <div className='cinema-hero-shade' />
        {showPoster && !renderingTrailer && (
          <div
            key={getBannerArtworkKey(currentItem)}
            className='cinema-hero-poster'
            aria-hidden='true'
          >
            <ProxyImage
              {...artworkFor(currentItem, 'poster')}
              alt=''
              loading='eager'
            />
          </div>
        )}
        <div className='cinema-hero-copy'>
          <p
            key={`eyebrow-${getBannerArtworkKey(currentItem)}`}
            className='cinema-eyebrow cinema-hero-enter'
          >
            <span /> 今晚，值得一看
          </p>
          <h1
            className='cinema-hero-enter'
            key={getBannerArtworkKey(currentItem)}
          >
            {currentItem.title}
          </h1>
          <div
            key={`meta-${getBannerArtworkKey(currentItem)}`}
            className='cinema-meta cinema-hero-enter'
          >
            {currentItem.vote_average > 0 && (
              <span className='cinema-score'>
                {currentItem.vote_average.toFixed(1)} <span>评分</span>
              </span>
            )}
            {currentItem.release_date && (
              <span>{currentItem.release_date.split('-')[0]}</span>
            )}
            {genres?.slice(0, 3).map((genre) => (
              <span key={genre}>{genre}</span>
            ))}
          </div>
          {(currentItem.subtitle || currentItem.overview) && (
            <p
              key={`synopsis-${getBannerArtworkKey(currentItem)}`}
              className='cinema-synopsis cinema-hero-enter'
            >
              {currentItem.subtitle || currentItem.overview}
            </p>
          )}
          <div className='cinema-hero-actions'>
            <button
              className='cinema-primary'
              onClick={() => handlePlay(currentItem.title)}
            >
              <Play size={18} fill='currentColor' />
              立即观看
            </button>
            <button
              className='cinema-secondary'
              onClick={() =>
                router.push(
                  '/search?q=' + encodeURIComponent(currentItem.title),
                )
              }
            >
              搜索片源
              <ChevronRight size={17} />
            </button>
            <button
              className='cinema-detail-trigger'
              aria-label={`查看影片详情：${currentItem.title}`}
              title='查看影片详情'
              onClick={() => {
                setDetailItem(currentItem);
                setDetailSource(dataSource);
                setIsDetailOpen(true);
              }}
            >
              <Info size={20} />
            </button>
          </div>
        </div>
        <div className='cinema-hero-pagination'>
          <div className='cinema-slide-position'>
            <span>{String(currentIndex + 1).padStart(2, '0')}</span>
            <span>/ {String(items.length).padStart(2, '0')}</span>
          </div>
          <div className='cinema-slide-dots'>
            {items.map((item, index) => (
              <button
                key={getBannerArtworkKey(item)}
                onClick={() => goToSlide(index)}
                aria-label={'查看推荐：' + item.title}
                aria-pressed={index === currentIndex}
              >
                <span data-active={index === currentIndex}>
                  {index === currentIndex && (
                    <i
                      key={`${currentIndex}-${autoPlayReset}-${rotationPaused}-${isFocusWithin}-${pageVisible}-${isDetailOpen}`}
                      className='cinema-slide-progress'
                    />
                  )}
                </span>
              </button>
            ))}
          </div>
          {items.length > 1 && (
            <div className='cinema-slide-controls'>
              <button onClick={goToPrevious} aria-label='上一部推荐'>
                <ChevronLeft size={18} />
              </button>
              <button onClick={goToNext} aria-label='下一部推荐'>
                <ChevronRight size={18} />
              </button>
              <button
                onClick={toggleRotation}
                aria-label={rotationPaused ? '继续自动轮播' : '暂停自动轮播'}
                aria-pressed={rotationPaused}
              >
                {rotationPaused ? <Play size={14} /> : <Pause size={14} />}
              </button>
            </div>
          )}
          {currentItem.trailer_url && showTrailer && (
            <button
              className='cinema-mute'
              onClick={toggleMute}
              aria-label={isMuted ? '开启预告片声音' : '关闭预告片声音'}
            >
              {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
          )}
        </div>
      </section>
      <nav
        ref={pickerRef}
        className='cinema-feature-picker'
        aria-label='切换精选影片'
        onFocusCapture={() => setIsFocusWithin(keyboardNavigation.current)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setIsFocusWithin(false);
        }}
      >
        {items.map((item, index) => (
          <button
            key={getBannerArtworkKey(item)}
            className='cinema-feature-pick'
            onClick={() => goToSlide(index)}
            aria-label={`选择精选影片：${item.title}`}
            aria-pressed={index === currentIndex}
          >
            <ProxyImage {...artworkFor(item, 'thumbnail')} alt='' />
            <span>
              <span className='cinema-feature-index'>
                {String(index + 1).padStart(2, '0')} /{' '}
                {index === currentIndex ? '正在推荐' : '精选影片'}
              </span>
              <strong>{item.title}</strong>
            </span>
          </button>
        ))}
      </nav>
      {detailItem && (
        <DetailPanel
          isOpen={isDetailOpen}
          onClose={() => setIsDetailOpen(false)}
          title={detailItem.title}
          poster={artworkFor(detailItem, 'poster').originalSrc}
          backdrop={artworkFor(detailItem, 'hero').originalSrc}
          tmdbId={detailSource === 'TMDB' ? Number(detailItem.id) : undefined}
          doubanId={detailSource === 'Douban' ? Number(detailItem.id) : undefined}
          type={detailItem.media_type === 'movie' ? 'movie' : 'tv'}
          cmsData={
            detailSource === 'TX'
              ? { desc: detailItem.overview || detailItem.subtitle }
              : undefined
          }
        />
      )}
    </>
  );
}
