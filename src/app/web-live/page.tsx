'use client';

import type ArtplayerInstance from 'artplayer';
import type FlvJsModule from 'flv.js';
import type HlsInstance from 'hls.js';
import { AlertTriangle,Radio } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { logger } from '@/lib/logger';
import { getRuntimeConfig } from '@/lib/runtime-config';
import { useWebLiveSync } from '@/hooks/useWebLiveSync';

import PageLayout from '@/components/PageLayout';
import ProxyImage from '@/components/ProxyImage';

type WebLiveSource = {
  key: string;
  name: string;
  platform: string;
  roomId: string;
  from?: 'config' | 'custom';
  disabled?: boolean;
};

type WebLiveStreamResponse = {
  url: string;
  originalUrl?: string;
  name?: string;
  title?: string;
  error?: string;
};

type ManagedVideoElement = HTMLVideoElement & {
  hls?: HlsInstance;
  flv?: FlvJsModule.Player;
};

type ArtplayerConstructor = typeof ArtplayerInstance;
type HlsConstructor = typeof HlsInstance;
type FlvJsModuleType = typeof FlvJsModule;

let Artplayer: ArtplayerConstructor | null = null;
let Hls: HlsConstructor | null = null;
let flvjs: FlvJsModuleType | null = null;

export default function WebLivePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const artRef = useRef<HTMLDivElement | null>(null);
  const artPlayerRef = useRef<ArtplayerInstance | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<'loading' | 'fetching' | 'ready'>('loading');
  const [sources, setSources] = useState<WebLiveSource[]>([]);
  const [currentSource, setCurrentSource] = useState<WebLiveSource | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [originalVideoUrl, setOriginalVideoUrl] = useState('');
  const [streamInfo, setStreamInfo] = useState<{ name?: string; title?: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'rooms' | 'platforms'>('rooms');
  const [isChannelListCollapsed, setIsChannelListCollapsed] = useState(false);
  const [isVideoLoading, setIsVideoLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  // Runtime config is fixed for this document; keep the server's loading view during hydration.
  const isWebLiveEnabled = useSyncExternalStore(
    () => () => undefined,
    () => getRuntimeConfig().WEB_LIVE_ENABLED ?? false,
    () => null
  );
  const [librariesLoaded, setLibrariesLoaded] = useState(false);
  const hasAutoLoadedRef = useRef(false); // 防止重复自动加载

  // 清理播放器资源的统一函数
  const cleanupPlayer = useCallback(() => {
    if (artPlayerRef.current) {
      try {
        // 先暂停播放
        const video = artPlayerRef.current.video as ManagedVideoElement;
        video.pause();
        video.src = '';
        video.load();

        // 销毁 HLS 实例
        if (video.hls) {
          video.hls.destroy();
          video.hls = undefined;
        }

        // 销毁 FLV 实例
        if (video.flv) {
          try {
            if (video.flv.unload) {
              video.flv.unload();
            }
            video.flv.destroy();
            video.flv = undefined;
          } catch (flvError) {
            logger.warn('FLV实例销毁时出错:', flvError);
            video.flv = undefined;
          }
        }

        // 移除所有事件监听器
        artPlayerRef.current.off('ready');
        artPlayerRef.current.off('error');

        // 销毁 ArtPlayer 实例
        artPlayerRef.current.destroy();
        artPlayerRef.current = null;
      } catch (err) {
        logger.warn('清理播放器资源时出错:', err);
        artPlayerRef.current = null;
      }
    }
  }, []);

  const handleSourceClick = useCallback(async (source: WebLiveSource) => {
    // 立即清理旧的播放器
    cleanupPlayer();

    setCurrentSource(source);
    setIsVideoLoading(true);
    setErrorMessage(null);
    setStreamInfo(null);

    // 更新 URL 参数
    const newSearchParams = new URLSearchParams(searchParams.toString());
    newSearchParams.set('platform', source.platform);
    newSearchParams.set('roomId', source.roomId);
    router.replace(`/web-live?${newSearchParams.toString()}`);

    try {
      const res = await fetch(`/api/web-live/stream?platform=${source.platform}&roomId=${source.roomId}`);
      if (res.ok) {
        const data = await res.json() as WebLiveStreamResponse;

        // 等待 DOM 渲染完成后再设置 videoUrl
        const waitForDom = () => {
          if (artRef.current) {
            setVideoUrl(data.url);
            setOriginalVideoUrl(data.originalUrl || data.url);
          } else {
            requestAnimationFrame(waitForDom);
          }
        };

        // 使用 requestAnimationFrame 等待下一帧
        requestAnimationFrame(waitForDom);

        // 保存主播信息
        if (data.name || data.title) {
          setStreamInfo({
            name: data.name,
            title: data.title
          });
        }
      } else {
        const data = await res.json() as Pick<WebLiveStreamResponse, 'error'>;
        setErrorMessage(data.error || '获取直播流失败');
      }
    } catch (err) {
      logger.error('获取直播流失败:', err);
      setErrorMessage(err instanceof Error ? err.message : '获取直播流失败');
    } finally {
      setIsVideoLoading(false);
    }
  }, [cleanupPlayer, router, searchParams]);

  const handleSourceChange = useCallback((sourceKey: string) => {
    if (!Array.isArray(sources)) return;
    const source = sources.find(item => item.key === sourceKey);
    if (source) {
      handleSourceClick(source);
    }
  }, [handleSourceClick, sources]);

  // 观影室同步功能
  const webLiveSync = useWebLiveSync({
    currentSourceKey: currentSource?.key || '',
    currentSourceName: currentSource?.name || '',
    currentSourcePlatform: currentSource?.platform || '',
    currentSourceRoomId: currentSource?.roomId || '',
    onSourceChange: handleSourceChange,
  });

  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'referrer';
    meta.content = 'no-referrer';
    document.head.appendChild(meta);
    const controller = new AbortController();
    let cancelled = false;

    if (typeof window !== 'undefined') {
      // 异步加载所有必需的库
      Promise.all([
        import('artplayer').then(mod => { Artplayer = mod.default; }),
        import('hls.js').then(mod => { Hls = mod.default; }),
        import('flv.js').then(mod => { flvjs = mod.default; })
      ]).then(() => {
        if (!cancelled) setLibrariesLoaded(true);
      });

      // 检查网络直播功能是否启用
      const runtimeConfig = getRuntimeConfig();
      const enabled = runtimeConfig?.WEB_LIVE_ENABLED ?? false;

      if (enabled) {
        fetch('/api/web-live/sources', { signal: controller.signal })
          .then(async (res) => {
            if (cancelled || !res.ok) return;
            setLoadingStage('fetching');
            const data = await res.json();
            if (cancelled) return;
            setSources(data as WebLiveSource[]);
            setLoadingStage('ready');
            await new Promise(resolve => setTimeout(resolve, 500));
          })
          .catch((err) => {
            if (!cancelled) logger.error('获取直播源失败:', err);
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
      }
    }

    return () => {
      cancelled = true;
      controller.abort();
      document.head.removeChild(meta);
    };
  }, []);

  // 当 sources 加载完成后，检查 URL 参数并自动加载对应的频道
  useEffect(() => {
    if (!sources || sources.length === 0) return;
    if (!librariesLoaded) return; // 等待库加载完成

    // 直接从 searchParams 读取，而不是从 useState
    const needLoadPlatform = searchParams.get('platform');
    const needLoadRoomId = searchParams.get('roomId');

    if (!needLoadPlatform || !needLoadRoomId) {
      hasAutoLoadedRef.current = false; // 重置标志
      return;
    }

    // 检查是否已经加载了这个频道
    if (currentSource?.platform === needLoadPlatform && currentSource?.roomId === needLoadRoomId) {
      return;
    }

    // 防止重复加载
    if (hasAutoLoadedRef.current) {
      return;
    }

    hasAutoLoadedRef.current = true;

    // 查找匹配的 source
    const foundSource = sources.find(s => s.platform === needLoadPlatform && s.roomId === needLoadRoomId);
    if (foundSource) {
      void handleSourceClick(foundSource);
      return;
    } else {
      hasAutoLoadedRef.current = false; // 重置标志以便重试
    }
  }, [currentSource?.platform, currentSource?.roomId, handleSourceClick, librariesLoaded, searchParams, sources]);

  function m3u8Loader(video: HTMLVideoElement, url: string) {
    if (!Hls) return;
    const hls = new Hls({ debug: false, enableWorker: true, lowLatencyMode: true });
    hls.loadSource(url);
    hls.attachMedia(video);
    (video as ManagedVideoElement).hls = hls;
  }

  function flvLoader(video: HTMLVideoElement, url: string) {
    if (!flvjs) return;
    const flvPlayer = flvjs.createPlayer({ type: 'flv', url, isLive: true });
    flvPlayer.attachMediaElement(video);
    flvPlayer.on(flvjs.Events.ERROR, (errorType: string, errorDetail: string) => {
      logger.error('FLV.js error:', errorType, errorDetail);
      setErrorMessage(`播放失败: ${errorType} - ${errorDetail}`);
      setVideoUrl('');
    });
    flvPlayer.load();
    (video as ManagedVideoElement).flv = flvPlayer;
  }

  useEffect(() => {
    if (!Artplayer || !Hls || !flvjs || !videoUrl || !artRef.current) return;

    // 销毁旧的播放器实例
    cleanupPlayer();

    artPlayerRef.current = new Artplayer({
      container: artRef.current,
      url: videoUrl,
      isLive: true,
      autoplay: true,
      fullscreen: true,
      customType: {
        m3u8: m3u8Loader,
        flv: flvLoader
      },
      icons: { loading: '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 100 100"><circle cx="50" cy="50" fill="none" stroke="currentColor" stroke-width="4" r="35" stroke-dasharray="164.93361431346415 56.97787143782138"><animateTransform attributeName="transform" type="rotate" repeatCount="indefinite" dur="1s" values="0 50 50;360 50 50" keyTimes="0;1"/></circle></svg>' }
    });

    return () => {
      cleanupPlayer();
    };
  }, [cleanupPlayer, videoUrl]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      cleanupPlayer();
    };
  }, [cleanupPlayer]);

  // 页面卸载前清理
  useEffect(() => {
    const handleBeforeUnload = () => {
      cleanupPlayer();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      cleanupPlayer();
    };
  }, [cleanupPlayer]);

  const getRoomUrl = (source: WebLiveSource) => {
    if (source.platform === 'huya') {
      return `https://huya.com/${source.roomId}`;
    }
    if (source.platform === 'bilibili') {
      return `https://live.bilibili.com/${source.roomId}`;
    }
    if (source.platform === 'douyin') {
      return `https://live.douyin.com/${source.roomId}`;
    }
    return '';
  };

  const platforms = Array.from(new Set(sources.map(s => s.platform)));

  // 根据选中的平台筛选房间
  const filteredSources = selectedPlatform
    ? sources.filter(s => s.platform === selectedPlatform)
    : sources;

  // 处理平台点击
  const handlePlatformClick = (platform: string) => {
    setSelectedPlatform(platform);
    setActiveTab('rooms');
  };

  // 清除平台筛选
  const clearPlatformFilter = () => {
    setSelectedPlatform(null);
  };

  // 如果功能未启用，显示提示
  if (isWebLiveEnabled === false) {
    return (
      <PageLayout activePath='/web-live'>
        <div className='flex items-center justify-center min-h-screen bg-transparent'>
          <div className='text-center max-w-md mx-auto px-6'>
            <div className='relative mb-8'>
              <div className='relative mx-auto w-24 h-24 bg-linear-to-r from-orange-500 to-red-600 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                <AlertTriangle className='w-12 h-12 text-white' />
                <div className='absolute -inset-2 bg-linear-to-r from-orange-500 to-red-600 rounded-2xl opacity-20 animate-pulse'></div>
              </div>
            </div>

            <div className='space-y-4'>
              <h3 className='text-2xl font-bold text-gray-900 dark:text-gray-100'>功能未启用</h3>
              <div className='bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4'>
                <p className='text-sm text-gray-700 dark:text-gray-300 leading-relaxed'>
                  网络直播功能当前未启用。请联系管理员在管理面板中开启此功能。
                </p>
              </div>
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (loading) {
    return (
      <PageLayout activePath='/web-live'>
        <div className='flex items-center justify-center min-h-screen bg-transparent'>
          <div className='text-center max-w-md mx-auto px-6'>
            {/* 动画直播图标 */}
            <div className='relative mb-8'>
              <div className='relative mx-auto w-24 h-24 bg-linear-to-r from-green-500 to-emerald-600 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                <div className='text-white text-4xl'>📺</div>
                {/* 旋转光环 */}
                <div className='absolute -inset-2 bg-linear-to-r from-green-500 to-emerald-600 rounded-2xl opacity-20 animate-spin'></div>
              </div>

              {/* 浮动粒子效果 */}
              <div className='absolute top-0 left-0 w-full h-full pointer-events-none'>
                <div className='absolute top-2 left-2 w-2 h-2 bg-green-400 rounded-full animate-bounce'></div>
                <div
                  className='absolute top-4 right-4 w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce'
                  style={{ animationDelay: '0.5s' }}
                ></div>
                <div
                  className='absolute bottom-3 left-6 w-1 h-1 bg-lime-400 rounded-full animate-bounce'
                  style={{ animationDelay: '1s' }}
                ></div>
              </div>
            </div>

            {/* 进度指示器 */}
            <div className='mb-6 w-80 mx-auto'>
              <div className='flex justify-center space-x-2 mb-4'>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${loadingStage === 'loading' ? 'bg-green-500 scale-125' : 'bg-green-500'}`}
                ></div>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${loadingStage === 'fetching' ? 'bg-green-500 scale-125' : 'bg-green-500'}`}
                ></div>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${loadingStage === 'ready' ? 'bg-green-500 scale-125' : 'bg-gray-300'}`}
                ></div>
              </div>

              {/* 进度条 */}
              <div className='w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden'>
                <div
                  className='h-full bg-linear-to-r from-green-500 to-emerald-600 rounded-full transition-all duration-1000 ease-out'
                  style={{
                    width: loadingStage === 'loading' ? '33%' : loadingStage === 'fetching' ? '66%' : '100%',
                  }}
                ></div>
              </div>
            </div>

            {/* 加载消息 */}
            <div className='space-y-2'>
              <p className='text-xl font-semibold text-gray-800 dark:text-gray-200 animate-pulse'>
                正在加载直播源...
              </p>
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout activePath='/web-live'>
      <div className='flex flex-col gap-3 py-4 px-5 lg:px-12 2xl:px-20'>
        <div className='py-1'>
          <h1 className='text-xl font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2 max-w-[80%]'>
            <Radio className='w-5 h-5 text-blue-500 shrink-0' />
            <div className='min-w-0 flex-1'>
              <div className='truncate'>
                {currentSource?.name || '网络直播'}
              </div>
            </div>
          </h1>
        </div>

        <div className='space-y-2'>
          <div className='hidden lg:flex justify-end'>
            <button
              onClick={() => setIsChannelListCollapsed(!isChannelListCollapsed)}
              className='group relative flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-white/80 hover:bg-white dark:bg-gray-800/80 dark:hover:bg-gray-800 backdrop-blur-xs border border-gray-200/50 dark:border-gray-700/50 shadow-xs hover:shadow-md transition-all duration-200'
            >
              <svg
                className={`w-3.5 h-3.5 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${isChannelListCollapsed ? 'rotate-180' : 'rotate-0'}`}
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M9 5l7 7-7 7' />
              </svg>
              <span className='text-xs font-medium text-gray-600 dark:text-gray-300'>
                {isChannelListCollapsed ? '显示' : '隐藏'}
              </span>
              <div className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full transition-all duration-200 ${isChannelListCollapsed ? 'bg-orange-400 animate-pulse' : 'bg-green-400'}`}></div>
            </button>
          </div>

          <div className={`grid gap-4 lg:h-[500px] xl:h-[650px] 2xl:h-[750px] transition-all duration-300 ease-in-out ${isChannelListCollapsed ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-4'}`}>
            <div className={`h-full transition-all duration-300 ease-in-out ${isChannelListCollapsed ? 'col-span-1' : 'md:col-span-3'}`}>
              <div className='relative w-full h-[300px] lg:h-full'>
                <div ref={artRef} className='bg-black w-full h-full rounded-xl overflow-hidden shadow-lg border border-white/0 dark:border-white/30'></div>

                {errorMessage && (
                  <div className='absolute inset-0 bg-black/90 backdrop-blur-xs rounded-xl overflow-hidden shadow-lg border border-white/0 dark:border-white/30 flex items-center justify-center z-600 transition-all duration-300'>
                    <div className='text-center max-w-md mx-auto px-6'>
                      <div className='relative mb-8'>
                        <div className='relative mx-auto w-24 h-24 bg-linear-to-r from-orange-500 to-red-600 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                          <div className='text-white text-4xl'>⚠️</div>
                          <div className='absolute -inset-2 bg-linear-to-r from-orange-500 to-red-600 rounded-2xl opacity-20 animate-pulse'></div>
                        </div>
                      </div>
                      <div className='space-y-4'>
                        <h3 className='text-xl font-semibold text-white'>获取直播流失败</h3>
                        <div className='bg-orange-500/20 border border-orange-500/30 rounded-lg p-4'>
                          <p className='text-orange-300 font-medium'>{errorMessage}</p>
                        </div>
                        <p className='text-sm text-gray-300'>请尝试其他房间</p>
                      </div>
                    </div>
                  </div>
                )}

                {isVideoLoading && (
                  <div className='absolute inset-0 bg-black/85 backdrop-blur-xs rounded-xl overflow-hidden shadow-lg border border-white/0 dark:border-white/30 flex items-center justify-center z-500 transition-all duration-300'>
                    <div className='text-center max-w-md mx-auto px-6'>
                      <div className='relative mb-8'>
                        <div className='relative mx-auto w-24 h-24 bg-linear-to-r from-green-500 to-emerald-600 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                          <div className='text-white text-4xl'>📺</div>
                          <div className='absolute -inset-2 bg-linear-to-r from-green-500 to-emerald-600 rounded-2xl opacity-20 animate-spin'></div>
                        </div>
                      </div>
                      <div className='space-y-2'>
                        <p className='text-xl font-semibold text-white animate-pulse'>🔄 加载中...</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 外部播放器按钮 */}
              {currentSource && !webLiveSync.isInRoom && (
                <div className='mt-3 px-2 lg:shrink-0 flex justify-end'>
                  <div className='bg-white/50 dark:bg-gray-800/50 backdrop-blur-xs rounded-lg p-2 border border-gray-200/50 dark:border-gray-700/50 w-full lg:w-auto overflow-x-auto'>
                    <div className='flex gap-1.5 justify-end lg:flex-wrap items-center'>
                      {/* 网页播放 */}
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          const roomUrl = getRoomUrl(currentSource);
                          if (roomUrl) {
                            window.open(roomUrl, '_blank');
                          }
                        }}
                        className='group relative flex items-center justify-center gap-1 w-8 h-8 lg:w-auto lg:h-auto lg:px-2 lg:py-1.5 bg-white hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 text-xs font-medium rounded-md transition-all duration-200 shadow-xs hover:shadow-md cursor-pointer overflow-hidden border border-gray-300 dark:border-gray-600 shrink-0'
                        title='网页播放'
                      >
                        <svg
                          className='w-4 h-4 shrink-0 text-gray-700 dark:text-gray-200'
                          fill='none'
                          stroke='currentColor'
                          viewBox='0 0 24 24'
                          xmlns='http://www.w3.org/2000/svg'
                        >
                          <path
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            strokeWidth={2}
                            d='M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25'
                          />
                        </svg>
                        <span className='hidden lg:inline max-w-0 group-hover:max-w-[100px] overflow-hidden whitespace-nowrap transition-all duration-200 ease-in-out text-gray-700 dark:text-gray-200'>
                          网页播放
                        </span>
                      </button>

                      {/* PotPlayer */}
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          if (originalVideoUrl) {
                            window.open(`potplayer://${originalVideoUrl}`, '_blank');
                          }
                        }}
                        className='group relative flex items-center justify-center gap-1 w-8 h-8 lg:w-auto lg:h-auto lg:px-2 lg:py-1.5 bg-white hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 text-xs font-medium rounded-md transition-all duration-200 shadow-xs hover:shadow-md cursor-pointer overflow-hidden border border-gray-300 dark:border-gray-600 shrink-0'
                        title='PotPlayer'
                      >
                        <ProxyImage
                          originalSrc='/players/potplayer.png'
                          alt='PotPlayer'
                          className='w-4 h-4 shrink-0'
                        />
                        <span className='hidden lg:inline max-w-0 group-hover:max-w-[100px] overflow-hidden whitespace-nowrap transition-all duration-200 ease-in-out text-gray-700 dark:text-gray-200'>
                          PotPlayer
                        </span>
                      </button>

                      {/* VLC */}
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          if (originalVideoUrl) {
                            window.open(`vlc://${originalVideoUrl}`, '_blank');
                          }
                        }}
                        className='group relative flex items-center justify-center gap-1 w-8 h-8 lg:w-auto lg:h-auto lg:px-2 lg:py-1.5 bg-white hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 text-xs font-medium rounded-md transition-all duration-200 shadow-xs hover:shadow-md cursor-pointer overflow-hidden border border-gray-300 dark:border-gray-600 shrink-0'
                        title='VLC'
                      >
                        <ProxyImage
                          originalSrc='/players/vlc.png'
                          alt='VLC'
                          className='w-4 h-4 shrink-0'
                        />
                        <span className='hidden lg:inline max-w-0 group-hover:max-w-[100px] overflow-hidden whitespace-nowrap transition-all duration-200 ease-in-out text-gray-700 dark:text-gray-200'>
                          VLC
                        </span>
                      </button>

                      {/* MPV */}
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          if (originalVideoUrl) {
                            window.open(`mpv://${originalVideoUrl}`, '_blank');
                          }
                        }}
                        className='group relative flex items-center justify-center gap-1 w-8 h-8 lg:w-auto lg:h-auto lg:px-2 lg:py-1.5 bg-white hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 text-xs font-medium rounded-md transition-all duration-200 shadow-xs hover:shadow-md cursor-pointer overflow-hidden border border-gray-300 dark:border-gray-600 shrink-0'
                        title='MPV'
                      >
                        <ProxyImage
                          originalSrc='/players/mpv.png'
                          alt='MPV'
                          className='w-4 h-4 shrink-0'
                        />
                        <span className='hidden lg:inline max-w-0 group-hover:max-w-[100px] overflow-hidden whitespace-nowrap transition-all duration-200 ease-in-out text-gray-700 dark:text-gray-200'>
                          MPV
                        </span>
                      </button>

                      {/* MX Player */}
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          if (originalVideoUrl) {
                            window.open(
                              `intent://${originalVideoUrl}#Intent;package=com.mxtech.videoplayer.ad;S.title=${encodeURIComponent(
                                currentSource?.name || '直播'
                              )};end`,
                              '_blank'
                            );
                          }
                        }}
                        className='group relative flex items-center justify-center gap-1 w-8 h-8 lg:w-auto lg:h-auto lg:px-2 lg:py-1.5 bg-white hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 text-xs font-medium rounded-md transition-all duration-200 shadow-xs hover:shadow-md cursor-pointer overflow-hidden border border-gray-300 dark:border-gray-600 shrink-0'
                        title='MX Player'
                      >
                        <ProxyImage
                          originalSrc='/players/mxplayer.png'
                          alt='MX Player'
                          className='w-4 h-4 shrink-0'
                        />
                        <span className='hidden lg:inline max-w-0 group-hover:max-w-[100px] overflow-hidden whitespace-nowrap transition-all duration-200 ease-in-out text-gray-700 dark:text-gray-200'>
                          MX Player
                        </span>
                      </button>

                      {/* nPlayer */}
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          if (originalVideoUrl) {
                            window.open(`nplayer-${originalVideoUrl}`, '_blank');
                          }
                        }}
                        className='group relative flex items-center justify-center gap-1 w-8 h-8 lg:w-auto lg:h-auto lg:px-2 lg:py-1.5 bg-white hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 text-xs font-medium rounded-md transition-all duration-200 shadow-xs hover:shadow-md cursor-pointer overflow-hidden border border-gray-300 dark:border-gray-600 shrink-0'
                        title='nPlayer'
                      >
                        <ProxyImage
                          originalSrc='/players/nplayer.png'
                          alt='nPlayer'
                          className='w-4 h-4 shrink-0'
                        />
                        <span className='hidden lg:inline max-w-0 group-hover:max-w-[100px] overflow-hidden whitespace-nowrap transition-all duration-200 ease-in-out text-gray-700 dark:text-gray-200'>
                          nPlayer
                        </span>
                      </button>

                      {/* IINA */}
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          if (originalVideoUrl) {
                            window.open(
                              `iina://weblink?url=${encodeURIComponent(originalVideoUrl)}`,
                              '_blank'
                            );
                          }
                        }}
                        className='group relative flex items-center justify-center gap-1 w-8 h-8 lg:w-auto lg:h-auto lg:px-2 lg:py-1.5 bg-white hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 text-xs font-medium rounded-md transition-all duration-200 shadow-xs hover:shadow-md cursor-pointer overflow-hidden border border-gray-300 dark:border-gray-600 shrink-0'
                        title='IINA'
                      >
                        <ProxyImage
                          originalSrc='/players/iina.png'
                          alt='IINA'
                          className='w-4 h-4 shrink-0'
                        />
                        <span className='hidden lg:inline max-w-0 group-hover:max-w-[100px] overflow-hidden whitespace-nowrap transition-all duration-200 ease-in-out text-gray-700 dark:text-gray-200'>
                          IINA
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* 直播信息显示 */}
              {streamInfo && (streamInfo.name || streamInfo.title) && (
                <div className='mt-3 px-2'>
                  <div className='space-y-1.5'>
                    {streamInfo.title && (
                      <div className='text-lg font-medium text-black dark:text-white line-clamp-2'>
                        {streamInfo.title}
                      </div>
                    )}
                    {streamInfo.name && (
                      <div className='text-base text-black dark:text-white'>
                        {streamInfo.name}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className={`h-[300px] lg:h-full md:overflow-hidden transition-all duration-300 ease-in-out ${isChannelListCollapsed ? 'md:col-span-1 lg:hidden lg:opacity-0 lg:scale-95' : 'md:col-span-1 lg:opacity-100 lg:scale-100'}`}>
              <div className='md:ml-2 px-4 py-0 h-full rounded-xl bg-black/10 dark:bg-white/5 flex flex-col border border-white/0 dark:border-white/30 overflow-hidden'>
                <div className='flex mb-1 -mx-6 shrink-0'>
                  <div
                    onClick={() => setActiveTab('rooms')}
                    className={`flex-1 py-3 px-6 text-center cursor-pointer transition-all duration-200 font-medium ${activeTab === 'rooms' ? 'text-green-600 dark:text-green-400' : 'text-gray-700 hover:text-green-600 bg-black/5 dark:bg-white/5 dark:text-gray-300 dark:hover:text-green-400 hover:bg-black/3 dark:hover:bg-white/3'}`}
                  >
                    房间
                  </div>
                  <div
                    onClick={() => setActiveTab('platforms')}
                    className={`flex-1 py-3 px-6 text-center cursor-pointer transition-all duration-200 font-medium ${activeTab === 'platforms' ? 'text-green-600 dark:text-green-400' : 'text-gray-700 hover:text-green-600 bg-black/5 dark:bg-white/5 dark:text-gray-300 dark:hover:text-green-400 hover:bg-black/3 dark:hover:bg-white/3'}`}
                  >
                    平台
                  </div>
                </div>

                {activeTab === 'rooms' && (
                  <div className='flex-1 overflow-y-auto space-y-2 pb-4 mt-4'>
                    {selectedPlatform && (
                      <div className='mb-3 flex items-center justify-between px-2 py-2 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800'>
                        <div className='flex items-center gap-2'>
                          <span className='text-xs text-green-700 dark:text-green-300'>筛选平台:</span>
                          <span className='text-sm font-medium text-green-800 dark:text-green-200'>
                            {selectedPlatform === 'huya' ? '虎牙' : selectedPlatform === 'bilibili' ? '哔哩哔哩' : selectedPlatform === 'douyin' ? '抖音' : selectedPlatform}
                          </span>
                        </div>
                        <button
                          onClick={clearPlatformFilter}
                          className='text-xs text-green-700 dark:text-green-300 hover:text-green-900 dark:hover:text-green-100 underline'
                        >
                          清除筛选
                        </button>
                      </div>
                    )}
                    {filteredSources.length > 0 ? (
                      filteredSources.map((source) => {
                        const isActive = source.key === currentSource?.key;
                        return (
                          <button
                            key={source.key}
                            onClick={() => handleSourceClick(source)}
                            disabled={webLiveSync.shouldDisableControls}
                            className={`w-full p-3 rounded-lg text-left transition-all duration-200 ${isActive ? 'bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700' : 'hover:bg-gray-100 dark:hover:bg-gray-700'} ${webLiveSync.shouldDisableControls ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            <div className='flex items-center gap-3'>
                              <div className='w-10 h-10 bg-gray-300 dark:bg-gray-700 rounded-lg flex items-center justify-center shrink-0'>
                                <Radio className='w-5 h-5 text-gray-500' />
                              </div>
                              <div className='flex-1 min-w-0'>
                                <div className='text-sm font-medium text-gray-900 dark:text-gray-100 truncate'>{source.name}</div>
                                <div className='text-xs text-gray-500 dark:text-gray-400 mt-1'>房间ID: {source.roomId}</div>
                              </div>
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <div className='flex flex-col items-center justify-center py-12 text-center'>
                        <div className='w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4'>
                          <Radio className='w-8 h-8 text-gray-400 dark:text-gray-600' />
                        </div>
                        <p className='text-gray-500 dark:text-gray-400 font-medium'>
                          {selectedPlatform ? '该平台暂无可用房间' : '暂无可用房间'}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'platforms' && (
                  <div className='flex flex-col h-full mt-4'>
                    <div className='flex-1 overflow-y-auto space-y-2 pb-20'>
                      {platforms.length > 0 ? (
                        platforms.map((platform) => (
                          <button
                            key={platform}
                            onClick={() => handlePlatformClick(platform)}
                            disabled={webLiveSync.shouldDisableControls}
                            className={`w-full flex items-start gap-3 px-2 py-3 rounded-lg bg-gray-200/50 dark:bg-white/10 hover:bg-gray-300/50 dark:hover:bg-white/20 transition-all duration-200 cursor-pointer ${webLiveSync.shouldDisableControls ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            <div className='w-12 h-12 bg-gray-200 dark:bg-gray-600 rounded-lg flex items-center justify-center shrink-0 overflow-hidden'>
                              {platform === 'huya' ? (
                                <ProxyImage originalSrc='https://hd.huya.com/favicon.ico' alt='虎牙' className='w-8 h-8' />
                              ) : platform === 'bilibili' ? (
                                <ProxyImage originalSrc='https://www.bilibili.com/favicon.ico' alt='哔哩哔哩' className='w-8 h-8' />
                              ) : platform === 'douyin' ? (
                                <ProxyImage originalSrc='https://lf1-cdn-tos.bytegoofy.com/goofy/ies/douyin_web/public/favicon.ico' alt='抖音' className='w-8 h-8' />
                              ) : (
                                <Radio className='w-6 h-6 text-gray-500' />
                              )}
                            </div>
                            <div className='flex-1 min-w-0 text-left'>
                              <div className='text-sm font-medium text-gray-900 dark:text-gray-100 truncate'>
                                {platform === 'huya' ? '虎牙' : platform === 'bilibili' ? '哔哩哔哩' : platform === 'douyin' ? '抖音' : platform}
                              </div>
                              <div className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                                {sources.filter(s => s.platform === platform).length} 个房间
                              </div>
                            </div>
                          </button>
                        ))
                      ) : (
                        <div className='flex flex-col items-center justify-center py-12 text-center'>
                          <div className='w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4'>
                            <Radio className='w-8 h-8 text-gray-400 dark:text-gray-600' />
                          </div>
                          <p className='text-gray-500 dark:text-gray-400 font-medium'>暂无可用平台</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
