/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console */

'use client';
import type { ReadonlyURLSearchParams } from 'next/navigation';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { useEffect, useRef } from 'react';

import {
  saveDanmakuDisplayState,
  saveDanmakuSettings,
} from '@/lib/danmaku/api';
import { isDanmakuEnabled } from '@/lib/danmaku/enabled';
import type { DanmakuSettings } from '@/lib/danmaku/types';
import { generateStorageKey, getAllPlayRecords } from '@/lib/db.client';
import { isLazyDetailSource, isNetdiskMountSource } from '@/lib/player/source';
import { DanmakuFilterConfig, SearchResult } from '@/lib/types';

import { loadPlayerPlugins } from './load-player-plugins';
import type { PlaybackProgressGuard } from './playback-progress';
import {
  HarmonyHlsPlaybackMode,
  NetdiskHlsPlaybackMode,
  PLAYBACK_RATE_OPTIONS,
  SourceSubtitleItem,
} from './types';
interface PlayerEngineContext {
  videoUrl: string;
  videoProgressRevision?: number;
  playbackProgressGuard?: PlaybackProgressGuard;
  loading: boolean;
  currentEpisodeIndex: number;
  artRef: MutableRefObject<HTMLDivElement | null>;
  currentSource: string;
  detail: SearchResult | null;
  setError: Dispatch<SetStateAction<string | null>>;
  totalEpisodes: number;
  videoMediaTypeRef: MutableRefObject<'' | 'hls' | 'file'>;
  isHarmonyOS: boolean;
  activeHarmonyHlsPlaybackModeRef: MutableRefObject<HarmonyHlsPlaybackMode | null>;
  harmonyHlsPlaybackMode: HarmonyHlsPlaybackMode;
  activeNativeHlsAdBlockRef: MutableRefObject<boolean | null>;
  nativeHlsAdBlockEnabled: boolean;
  currentSourceRef: MutableRefObject<string>;
  supportsNativeHls: boolean;
  activeNetdiskHlsPlaybackModeRef: MutableRefObject<NetdiskHlsPlaybackMode | null>;
  netdiskHlsPlaybackMode: NetdiskHlsPlaybackMode;
  artPlayerRef: MutableRefObject<any>;
  applyVideoCrossOrigin: (
    video: HTMLVideoElement | null,
    source?: string | null | undefined
  ) => void;
  videoTitle: string;
  playerEpisodeLabel: string;
  videoCover: string;
  isNetdiskNativeHlsActive: (source?: string | null | undefined) => boolean;
  buildNativeHlsPlaybackUrl: (url: string) => string;
  ensureVideoSource: (video: HTMLVideoElement | null, url: string) => void;
  cleanupPlayer: () => Promise<void>;
  createCustomHlsLoader: (HlsLib: any) => any;
  detailRef: MutableRefObject<SearchResult | null>;
  isAdvancedSourceSubtitle: (
    subtitle?: SourceSubtitleItem | null | undefined
  ) => boolean;
  currentSubtitleLabelRef: MutableRefObject<string>;
  videoQualities: { name: string; url: string }[];
  needsPrivateSourceCrossOrigin: (
    source?: string | null | undefined
  ) => boolean;
  mediaCorsFallbackRef: MutableRefObject<boolean>;
  blockAdEnabledRef: MutableRefObject<boolean>;
  isInitialLoadRef: MutableRefObject<boolean>;
  currentXiaoyaUrlRef: MutableRefObject<string>;
  shouldStartLinkRefreshTimer: (
    resolvedPlayUrl?: string | undefined
  ) => boolean;
  startRefreshTimer: (
    preferredHls?: any,
    preferredVideo?: HTMLVideoElement | undefined
  ) => void;
  refreshXiaoyaUrl: (
    preferredHls?: any,
    preferredVideo?: HTMLVideoElement | undefined,
    isScheduled?: boolean
  ) => Promise<boolean>;
  setVideoError: Dispatch<SetStateAction<string | null>>;
  setCorsFailedUrl: Dispatch<SetStateAction<string | null>>;
  isPlaybackThumbnailDisabled: () => boolean;
  danmakuSettingsRef: MutableRefObject<DanmakuSettings>;
  danmakuDisplayStateRef: MutableRefObject<boolean>;
  danmakuFilterConfigRef: MutableRefObject<DanmakuFilterConfig | null>;
  blockAdEnabled: boolean;
  resumeTimeRef: MutableRefObject<number | null>;
  setBlockAdEnabled: Dispatch<SetStateAction<boolean>>;
  setShowDanmakuFilterSettings: Dispatch<SetStateAction<boolean>>;
  danmakuHeatmapDisabledRef: MutableRefObject<boolean>;
  danmakuHeatmapEnabledRef: MutableRefObject<boolean>;
  setDanmakuHeatmapEnabled: Dispatch<SetStateAction<boolean>>;
  webGPUSupported: boolean;
  anime4kEnabledRef: MutableRefObject<boolean>;
  toggleAnime4K: (enabled: boolean) => Promise<void>;
  anime4kModeRef: MutableRefObject<string>;
  changeAnime4KMode: (mode: string) => Promise<void>;
  anime4kScaleRef: MutableRefObject<number>;
  changeAnime4KScale: (scale: number) => Promise<void>;
  skipConfigRef: MutableRefObject<{
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }>;
  handleSkipConfigChange: (newConfig: {
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }) => Promise<void>;
  formatQuickForwardDuration: (seconds: number) => string;
  quickForwardSecondsRef: MutableRefObject<number>;
  setQuickForwardSeconds: Dispatch<SetStateAction<number>>;
  formatTime: (seconds: number) => string;
  seekQuickForward: () => boolean;
  playSync: {
    isInRoom: boolean;
    isOwner: boolean;
    shouldDisableControls: boolean;
    broadcastPlayState: () => void;
  };
  handleNextEpisode: (resumePlayback?: boolean) => Promise<void>;
  syncAnime4KCanvasFlip: (flip?: string | undefined) => void;
  setPlayerReady: Dispatch<SetStateAction<boolean>>;
  currentEpisodeIndexRef: MutableRefObject<number>;
  switchSourceSubtitle: (subtitle: SourceSubtitleItem) => Promise<void>;
  updateSubtitleSetting: () => void;
  setDanmakuSettings: Dispatch<SetStateAction<DanmakuSettings>>;
  danmakuPluginRef: MutableRefObject<any>;
  autoSearchDanmaku: () => Promise<void>;
  requestWakeLock: () => Promise<void>;
  releaseWakeLock: () => Promise<void>;
  saveCurrentPlayProgress: () => Promise<void>;
  lastVolumeRef: MutableRefObject<number>;
  playbackRateRestoreWindowUntilRef: MutableRefObject<number>;
  lastPlaybackRateRef: MutableRefObject<number>;
  persistPlaybackRate: (rate: number) => void;
  setIsWebFullscreen: Dispatch<SetStateAction<boolean>>;
  resumePlayingAfterHlsModeSwitchRef: MutableRefObject<boolean | null>;
  setIsVideoLoading: Dispatch<SetStateAction<boolean>>;
  searchParams: ReadonlyURLSearchParams;
  playRecordJumpInitialCheckRef: MutableRefObject<boolean>;
  playRecordJumpDismissedRef: MutableRefObject<boolean>;
  playRecordJumpLayerRef: MutableRefObject<any>;
  currentIdRef: MutableRefObject<string>;
  lastSkipCheckRef: MutableRefObject<number>;
  proxyAttemptedRef: MutableRefObject<boolean>;
  lastSaveTimeRef: MutableRefObject<number>;
  nextEpisodePreCacheTriggeredRef: MutableRefObject<boolean>;
  nextEpisodeDanmakuPreloadTriggeredRef: MutableRefObject<boolean>;
  preloadNextEpisodeDanmaku: () => Promise<void>;
}
/** ArtPlayer/HLS lifecycle and cleanup. Dependencies remain explicit in the effect. */
export function usePlayerEngine({
  videoUrl,
  videoProgressRevision = 0,
  playbackProgressGuard,
  loading,
  currentEpisodeIndex,
  artRef,
  currentSource,
  detail,
  setError,
  totalEpisodes,
  videoMediaTypeRef,
  isHarmonyOS,
  activeHarmonyHlsPlaybackModeRef,
  harmonyHlsPlaybackMode,
  activeNativeHlsAdBlockRef,
  nativeHlsAdBlockEnabled,
  currentSourceRef,
  supportsNativeHls,
  activeNetdiskHlsPlaybackModeRef,
  netdiskHlsPlaybackMode,
  artPlayerRef,
  applyVideoCrossOrigin,
  videoTitle,
  playerEpisodeLabel,
  videoCover,
  isNetdiskNativeHlsActive,
  buildNativeHlsPlaybackUrl,
  ensureVideoSource,
  cleanupPlayer,
  createCustomHlsLoader,
  detailRef,
  isAdvancedSourceSubtitle,
  currentSubtitleLabelRef,
  videoQualities,
  needsPrivateSourceCrossOrigin,
  mediaCorsFallbackRef,
  blockAdEnabledRef,
  isInitialLoadRef,
  currentXiaoyaUrlRef,
  shouldStartLinkRefreshTimer,
  startRefreshTimer,
  refreshXiaoyaUrl,
  setVideoError,
  setCorsFailedUrl,
  isPlaybackThumbnailDisabled,
  danmakuSettingsRef,
  danmakuDisplayStateRef,
  danmakuFilterConfigRef,
  blockAdEnabled,
  resumeTimeRef,
  setBlockAdEnabled,
  setShowDanmakuFilterSettings,
  danmakuHeatmapDisabledRef,
  danmakuHeatmapEnabledRef,
  setDanmakuHeatmapEnabled,
  webGPUSupported,
  anime4kEnabledRef,
  toggleAnime4K,
  anime4kModeRef,
  changeAnime4KMode,
  anime4kScaleRef,
  changeAnime4KScale,
  skipConfigRef,
  handleSkipConfigChange,
  formatQuickForwardDuration,
  quickForwardSecondsRef,
  setQuickForwardSeconds,
  formatTime,
  seekQuickForward,
  playSync,
  handleNextEpisode,
  syncAnime4KCanvasFlip,
  setPlayerReady,
  currentEpisodeIndexRef,
  switchSourceSubtitle,
  updateSubtitleSetting,
  setDanmakuSettings,
  danmakuPluginRef,
  autoSearchDanmaku,
  requestWakeLock,
  releaseWakeLock,
  saveCurrentPlayProgress,
  lastVolumeRef,
  playbackRateRestoreWindowUntilRef,
  lastPlaybackRateRef,
  persistPlaybackRate,
  setIsWebFullscreen,
  resumePlayingAfterHlsModeSwitchRef,
  setIsVideoLoading,
  searchParams,
  playRecordJumpInitialCheckRef,
  playRecordJumpDismissedRef,
  playRecordJumpLayerRef,
  currentIdRef,
  lastSkipCheckRef,
  proxyAttemptedRef,
  lastSaveTimeRef,
  nextEpisodePreCacheTriggeredRef,
  nextEpisodeDanmakuPreloadTriggeredRef,
  preloadNextEpisodeDanmaku,
}: PlayerEngineContext) {
  const initializationRef = useRef(0);
  const hlsRequestRef = useRef(0);
  useEffect(() => () => { hlsRequestRef.current++; }, []);
  const activeMediaRef = useRef<{ player: any; revision: number; url: string; started: boolean; resetPosition: boolean } | null>(null);
  useEffect(() => {
    const initialization = ++initializationRef.current;
    const isCurrentInitialization = () => initialization === initializationRef.current &&
      (!playbackProgressGuard || playbackProgressGuard.isCurrent(videoProgressRevision));
    const isCurrentMedia = (player: any) => {
      const media = activeMediaRef.current;
      return !!media && media.player === player && player === artPlayerRef.current &&
        (!playbackProgressGuard || playbackProgressGuard.isCurrent(media.revision));
    };
    if (
      !isCurrentInitialization() ||
      !videoUrl ||
      loading ||
      currentEpisodeIndex === null ||
      !artRef.current
    ) {
      hlsRequestRef.current++;
      return;
    }

    // 这类源会先异步补全详情，如果 episodes 为空则跳过
    if (
      isLazyDetailSource(currentSource || detail?.source) &&
      (!detail || !detail.episodes || detail.episodes.length === 0)
    ) {
      return;
    }

    // 确保选集索引有效
    if (
      !detail ||
      !detail.episodes ||
      currentEpisodeIndex >= detail.episodes.length ||
      currentEpisodeIndex < 0
    ) {
      setError(`选集索引无效，当前共 ${totalEpisodes} 集`);
      return;
    }

    if (!videoUrl) {
      setError('视频地址无效');
      return;
    }
    console.log(videoUrl);

    // 检测是否为WebKit浏览器
    const isWebkit =
      typeof window !== 'undefined' &&
      typeof (window as any).webkitConvertPointFromNodeToPage === 'function';

    // 检测是否为 iOS 设备（iPhone、iPad、iPod）
    const isIOS = (() => {
      if (typeof window === 'undefined') return false;

      const ua = navigator.userAgent;

      // 排除 Windows Phone（它的 UA 中也包含 iPhone）
      if ((window as any).MSStream) return false;

      // 方法1：检测 UA 中的 iOS 设备标识
      if (/iPad|iPhone|iPod/.test(ua)) {
        console.log('[设备检测] iOS 设备（通过 UA）:', ua);
        return true;
      }

      // 方法2：检测 iPad（iOS 13+ 桌面模式）
      // 条件：UA 包含 Mac + 支持触摸 + 不是 Windows/Linux
      const isMacUA = ua.includes('Mac OS X');
      const hasTouch = 'ontouchend' in document;
      const isNotWindows = !ua.includes('Windows');
      const isNotLinux = !ua.includes('Linux');

      if (isMacUA && hasTouch && isNotWindows && isNotLinux) {
        console.log('[设备检测] iPad 桌面模式:', { ua, hasTouch });
        return true;
      }

      console.log('[设备检测] 非 iOS 设备:', { ua, hasTouch });
      return false;
    })();

    // 辅助函数：检测代理 URL 是否需要显式声明 m3u8 类型
    // Artplayer 通过 URL 扩展名自动检测类型，但代理 URL（如 /api/proxy-m3u8?url=...）没有 .m3u8 扩展名
    const getVideoType = (url: string): string | undefined => {
      if (!url) return undefined;
      // 单文件直链（mkv/mp4 等，mediaType=file）：走原生播放，勿强声明 m3u8
      if (videoMediaTypeRef.current === 'file') return undefined;
      // 如果 URL 路径中已包含 .m3u8 扩展名，Artplayer 可自动检测，无需显式设置
      const urlPath = url.split('?')[0];
      if (urlPath.includes('.m3u8')) return undefined;
      // 代理 URL 返回的是 m3u8 内容，需要显式声明类型
      if (
        url.includes('/api/proxy-m3u8') ||
        url.includes('/api/proxy/vod/m3u8')
      ) {
        return 'm3u8';
      }
      return undefined;
    };

    const needsHarmonyHlsModeReinit =
      isHarmonyOS &&
      (activeHarmonyHlsPlaybackModeRef.current !== harmonyHlsPlaybackMode ||
        (harmonyHlsPlaybackMode === 'native' &&
          activeNativeHlsAdBlockRef.current !== nativeHlsAdBlockEnabled));

    // 网盘挂载切换 HLS 模式时同样需要整体重建（customType 闭包捕获旧模式）
    const needsNetdiskHlsModeReinit =
      isNetdiskMountSource(currentSourceRef.current) &&
      supportsNativeHls &&
      activeNetdiskHlsPlaybackModeRef.current !== null &&
      activeNetdiskHlsPlaybackModeRef.current !== netdiskHlsPlaybackMode;

    // 非WebKit浏览器且播放器已存在，使用switch方法切换
    if (
      !isWebkit &&
      artPlayerRef.current &&
      !needsHarmonyHlsModeReinit &&
      !needsNetdiskHlsModeReinit
    ) {
      // 显式设置类型，确保代理 URL 能被 HLS.js 正确处理
      const videoType = getVideoType(videoUrl);
      if (videoType) {
        artPlayerRef.current.option.type = videoType;
      } else {
        artPlayerRef.current.option.type = '';
      }
      // switch 前先对齐 crossOrigin，避免私人影库直链以非 CORS 模式缓存后无法超分
      if (artPlayerRef.current?.video) {
        applyVideoCrossOrigin(
          artPlayerRef.current.video as HTMLVideoElement,
          currentSourceRef.current
        );
      }
      // switch 自身不回收上一个 HLS 实例，只有新地址仍是 m3u8 时 customType 才会接管并销毁它。
      // 切到直链（mp4 等）时旧实例会残留并继续拉分片，所以这里统一先销毁。
      const previousVideo = artPlayerRef.current.video as
        | (HTMLVideoElement & { hls?: { destroy?: () => void } })
        | undefined;
      const sameUrl = activeMediaRef.current?.url === videoUrl;
      if (!sameUrl && previousVideo?.hls) {
        try {
          previousVideo.hls.destroy?.();
        } catch (err) {
          console.warn('切换视频源时销毁旧 HLS 实例失败:', err);
        }
        delete previousVideo.hls;
      }
      if (!sameUrl && previousVideo) {
        hlsRequestRef.current++;
        previousVideo.pause();
        previousVideo.removeAttribute('src');
        previousVideo.load();
      }
      activeMediaRef.current = { player: artPlayerRef.current, revision: videoProgressRevision, url: videoUrl,
        started: sameUrl && (activeMediaRef.current?.started || artPlayerRef.current.video?.readyState >= 3),
        resetPosition: sameUrl && activeMediaRef.current?.revision !== videoProgressRevision };
      if (!sameUrl) artPlayerRef.current.switch = videoUrl;
      if (sameUrl && artPlayerRef.current.video?.readyState >= 3) {
        artPlayerRef.current.emit('video:canplay');
      }
      artPlayerRef.current.title = `${videoTitle} - ${playerEpisodeLabel}`;
      artPlayerRef.current.poster = videoCover;
      if (artPlayerRef.current?.video) {
        const exposedVideoUrl = isNetdiskNativeHlsActive(
          currentSourceRef.current
        )
          ? videoUrl
          : isHarmonyOS && harmonyHlsPlaybackMode === 'native'
          ? buildNativeHlsPlaybackUrl(videoUrl)
          : videoUrl;
        ensureVideoSource(
          artPlayerRef.current.video as HTMLVideoElement,
          exposedVideoUrl
        );
      }
      return;
    }

    // WebKit浏览器或首次创建：销毁之前的播放器实例并创建新的
    // 异步初始化播放器
    hlsRequestRef.current++;
    const initPlayer = async () => {
      try {
        // 先清理旧播放器实例
        if (artPlayerRef.current) {
          await cleanupPlayer();
          if (!isCurrentInitialization()) return;
          // Rebuilds retain the DOM cleanup grace period; first playback has
          // no previous player or MediaSource to release.
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (!isCurrentInitialization()) return;

        // 双重检查：如果旧播放器仍然存在，再次清理
        if (artPlayerRef.current) {
          console.warn('旧播放器仍存在，再次清理');
          await cleanupPlayer();
          if (!isCurrentInitialization()) return;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (!isCurrentInitialization() || !artRef.current) return;

        // 再次确保容器为空
        if (artRef.current) {
          artRef.current.innerHTML = '';
        }

        // Native/file playback can create ArtPlayer without downloading HLS.js.
        // Known HLS sources still load both libraries in parallel.
        let hlsModulePromise: Promise<typeof import('hls.js')> | undefined;
        const loadHls = () => {
          if (!hlsModulePromise) {
            hlsModulePromise = import('hls.js').catch((error) => {
              hlsModulePromise = undefined;
              throw error;
            });
          }
          return hlsModulePromise;
        };
        const needsHlsInitially =
          !isNetdiskNativeHlsActive(currentSourceRef.current) &&
          !(isHarmonyOS && harmonyHlsPlaybackMode === 'native') &&
          videoMediaTypeRef.current !== 'file' &&
          (videoMediaTypeRef.current === 'hls' ||
            getVideoType(videoUrl) === 'm3u8' ||
            /\.m3u8?(?:[?#]|$)/i.test(videoUrl));
        const [ArtplayerModule, HlsModule, optionalPlugins] =
          await Promise.all([
            import('artplayer'),
            needsHlsInitially ? loadHls() : undefined,
            loadPlayerPlugins({ danmaku: isDanmakuEnabled(), thumbnails: !isPlaybackThumbnailDisabled() }),
          ]);
        if (!isCurrentInitialization() || !artRef.current) return;

        const Artplayer = ArtplayerModule.default;
        const initialHls = HlsModule?.default;
        const artplayerPluginDanmuku = optionalPlugins.danmaku;
        const artplayerPluginAutoThumbnail = optionalPlugins.thumbnails;
        const playerTimeouts = new Set<number>();
        const clearTrackedTimeout = (timeoutId: number | null) => {
          if (timeoutId == null) {
            return;
          }

          window.clearTimeout(timeoutId);
          playerTimeouts.delete(timeoutId);
        };
        const schedulePlayerTimeout = (callback: () => void, delay: number) => {
          const timeoutId = window.setTimeout(() => {
            playerTimeouts.delete(timeoutId);
            callback();
          }, delay);
          playerTimeouts.add(timeoutId);
          return timeoutId;
        };
        const clearPlayerTimeouts = () => {
          playerTimeouts.forEach((timeoutId) => {
            window.clearTimeout(timeoutId);
          });
          playerTimeouts.clear();
        };

        const syncPlaybackPitch = () => {
          if (!isWebkit || !artPlayerRef.current?.video) {
            return;
          }

          const video = artPlayerRef.current.video as HTMLVideoElement & {
            webkitPreservesPitch?: boolean;
          };
          const shouldPreservePitch = true;

          if ('preservesPitch' in video) {
            video.preservesPitch = shouldPreservePitch;
          }
          if ('webkitPreservesPitch' in video) {
            video.webkitPreservesPitch = shouldPreservePitch;
          }
        };

        const shouldRescueWebkitHls = (
          video: HTMLVideoElement & {
            hls?: {
              detachMedia?: () => void;
              attachMedia?: (video: HTMLVideoElement) => void;
              startLoad?: (startPosition?: number) => void;
              bufferController?: {
                mediaSource?: {
                  readyState?: string;
                };
              };
            };
          }
        ) => {
          const hls = video.hls;
          if (!hls) {
            return false;
          }

          let hasBufferedData = false;
          try {
            hasBufferedData = video.buffered.length > 0;
          } catch {
            hasBufferedData = false;
          }

          if (video.readyState > 0 || hasBufferedData) {
            return false;
          }

          const currentSrc = video.currentSrc || video.src || '';
          const mediaSourceState =
            hls.bufferController?.mediaSource?.readyState || '';
          const usingBlobMsePath =
            currentSrc.startsWith('blob:') && mediaSourceState !== 'closed';

          return !usingBlobMsePath;
        };

        const rescueWebkitHlsBootstrap = (
          reason: string,
          retryDelays: number[] = [1500, 3500, 6000]
        ) => {
          if (!isWebkit || !artPlayerRef.current?.video) {
            return;
          }

          const video = artPlayerRef.current.video as HTMLVideoElement & {
            hls?: {
              detachMedia?: () => void;
              attachMedia?: (video: HTMLVideoElement) => void;
              startLoad?: (startPosition?: number) => void;
            };
          };

          retryDelays.forEach((delay) => {
            schedulePlayerTimeout(() => {
              if (
                !artPlayerRef.current ||
                artPlayerRef.current.video !== video
              ) {
                return;
              }

              const hls = video.hls;
              if (!shouldRescueWebkitHls(video)) {
                return;
              }

              console.warn(
                `[HLS] Safari bootstrap rescue triggered (${reason}, ${delay}ms)`
              );

              try {
                hls.detachMedia?.();
                hls.attachMedia?.(video);
                hls.startLoad?.(-1);
                video.play().catch((error) => {
                  console.warn('[HLS] Safari rescue play failed:', error);
                });
              } catch (error) {
                console.warn('[HLS] Safari bootstrap rescue failed:', error);
              }
            }, delay);
          });
        };

        // 创建新的播放器实例
        Artplayer.PLAYBACK_RATE = PLAYBACK_RATE_OPTIONS;
        Artplayer.USE_RAF = true;

        // 获取当前集的字幕
        const currentSubtitles = (detailRef.current?.subtitles?.[
          currentEpisodeIndex
        ] || []) as SourceSubtitleItem[];
        const defaultSubtitle = currentSubtitles[0];
        const shouldUseNativeInitialSubtitle =
          !!defaultSubtitle && !isAdvancedSourceSubtitle(defaultSubtitle);
        const savedSubtitleSize =
          typeof window !== 'undefined'
            ? localStorage.getItem('subtitleSize') || '2em'
            : '2em';
        currentSubtitleLabelRef.current = defaultSubtitle?.label || '关闭';

        artPlayerRef.current = new Artplayer({
          container: artRef.current!,
          url: videoUrl,
          ...(getVideoType(videoUrl) ? { type: getVideoType(videoUrl) } : {}),
          poster: videoCover,
          volume: 0.7,
          isLive: false,
          muted: false,
          autoplay: true,
          pip: true,
          autoSize: false,
          autoMini: false,
          screenshot: true,
          setting: true,
          loop: false,
          flip: true,
          playbackRate: true,
          aspectRatio: false,
          fullscreen: !isIOS, // iOS 禁用原生全屏按钮，避免触发系统播放器
          fullscreenWeb: true, // 保留网页全屏按钮（所有平台）
          ...(shouldUseNativeInitialSubtitle
            ? {
                subtitle: {
                  url: defaultSubtitle!.url,
                  type: 'vtt',
                  style: {
                    color: '#fff',
                    fontSize: savedSubtitleSize,
                  },
                  encoding: 'utf-8',
                },
              }
            : {}),
          subtitleOffset: false,
          miniProgressBar: false,
          mutex: true,
          playsInline: true,
          autoPlayback: false,
          airplay: true,
          theme: '#22c55e',
          lang: 'zh-cn',
          hotkey: false,
          fastForward: true,
          autoOrientation: true,
          lock: true,
          ...(videoQualities.length > 0
            ? {
                quality: videoQualities.map((q, index) => ({
                  default: index === 0,
                  html: q.name,
                  url: q.url,
                })),
              }
            : {}),
          moreVideoAttr: {
            playsInline: true,
            'webkit-playsinline': 'true',
            referrerpolicy: 'no-referrer',
            // 私人影库/网盘直链：配合支持 PureTV 的扩展注入 ACAO，供 Anime4K 读帧。
            // 单文件直链（mediaType=file）与网盘挂载原生 HLS 也先乐观 CORS，
            // 无 ACAO 的 CDN 首次播放 error 时一次性回退 no-cors（见 error 处理器）。
            ...(needsPrivateSourceCrossOrigin(currentSourceRef.current) &&
            !mediaCorsFallbackRef.current
              ? { crossOrigin: 'anonymous' }
              : {}),
          } as any,
          // HLS 支持配置
          customType: {
            m3u8: async function (video: HTMLVideoElement, url: string) {
              const hlsRequest = ++hlsRequestRef.current;
              // 网盘挂载原生 HLS：直接把 m3u8 交给浏览器原生播放器（Edge/Safari），
              // 直连网盘 CDN，无需代理与去广告。此时 video 已乐观带上 crossOrigin
              // （配合扩展注入 ACAO 供 Anime4K 读帧）；无 ACAO 时首次播放 error
              // 会触发一次性 no-cors 回退，见 error 处理器。
              if (isNetdiskNativeHlsActive(currentSourceRef.current)) {
                if (video.hls) {
                  video.hls.destroy();
                  delete video.hls;
                }

                video.src = url;
                ensureVideoSource(video, url);
                video.load();
                return;
              }

              if (isHarmonyOS && harmonyHlsPlaybackMode === 'native') {
                if (video.hls) {
                  video.hls.destroy();
                  delete video.hls;
                }

                // 不 attach MediaSource，直接把 m3u8 交给 ArkWeb/浏览器原生播放器。
                // currentSrc 会保留实际播放地址，供浏览器内置投屏功能读取。
                const nativePlaybackUrl = buildNativeHlsPlaybackUrl(url);
                video.src = nativePlaybackUrl;
                ensureVideoSource(video, nativePlaybackUrl);
                video.load();
                return;
              }

              // A file/native session may later switch to HLS on this player.
              let Hls = initialHls;
              if (!Hls) {
                try {
                  Hls = (await loadHls()).default;
                } catch (error) {
                  if (hlsRequest === hlsRequestRef.current) {
                    console.error('HLS.js 加载失败:', error);
                    setVideoError('播放器加载失败，请重试');
                  }
                  return;
                }
                if (
                  hlsRequest !== hlsRequestRef.current ||
                  artPlayerRef.current?.video !== video
                ) {
                  return;
                }
              }

              if (video.hls) {
                video.hls.destroy();
              }

              // 每次创建HLS实例时，都读取最新的blockAdEnabled状态
              const shouldUseCustomLoader = blockAdEnabledRef.current;
              const CustomHlsJsLoader = createCustomHlsLoader(Hls);

              // 从localStorage读取缓冲策略
              const bufferStrategy =
                typeof window !== 'undefined'
                  ? localStorage.getItem('bufferStrategy') || 'medium'
                  : 'medium';

              // 根据缓冲策略配置不同的缓冲参数
              const getBufferConfig = (strategy: string) => {
                switch (strategy) {
                  case 'low':
                    return {
                      maxBufferLength: 15,
                      backBufferLength: 15,
                      maxBufferSize: 30 * 1000 * 1000, // ~30MB
                    };
                  case 'medium':
                    return {
                      maxBufferLength: 30,
                      backBufferLength: 30,
                      maxBufferSize: 60 * 1000 * 1000, // ~60MB
                    };
                  case 'high':
                    return {
                      maxBufferLength: 60,
                      backBufferLength: 40,
                      maxBufferSize: 120 * 1000 * 1000, // ~120MB
                    };
                  case 'ultra':
                    return {
                      maxBufferLength: 120,
                      backBufferLength: 60,
                      maxBufferSize: 240 * 1000 * 1000, // ~240MB
                    };
                  default:
                    return {
                      maxBufferLength: 30,
                      backBufferLength: 30,
                      maxBufferSize: 60 * 1000 * 1000,
                    };
                }
              };

              const bufferConfig = getBufferConfig(bufferStrategy);

              // 选择合适的 Loader
              let loaderClass;
              if (shouldUseCustomLoader) {
                // 使用自定义广告过滤 Loader
                loaderClass = CustomHlsJsLoader;
              } else {
                // 使用默认 Loader
                loaderClass = Hls.DefaultConfig.loader;
              }

              const hls = new Hls({
                debug: false, // 关闭日志
                enableWorker: true, // WebWorker 解码，降低主线程压力
                // 点播播放不需要 LL-HLS，小缓冲在 Safari 高倍速下更容易抖动。
                lowLatencyMode: false,
                autoStartLoad: true,

                /* 缓冲/内存相关 - 根据用户设置的缓冲策略动态调整 */
                maxBufferLength: bufferConfig.maxBufferLength, // 前向缓冲长度
                backBufferLength: bufferConfig.backBufferLength, // 已播放内容保留长度
                maxBufferSize: bufferConfig.maxBufferSize, // 最大缓冲大小

                /* 自定义loader */
                loader: loaderClass as any,
              });

              const kickStartHlsPlayback = () => {
                try {
                  hls.startLoad(-1);
                } catch (error) {
                  console.warn('[HLS] startLoad failed:', error);
                }

                if (!video.paused) {
                  video.play().catch((error) => {
                    console.warn('[HLS] play after attach failed:', error);
                  });
                }
              };

              hls.on(Hls.Events.MEDIA_ATTACHED, () => {
                kickStartHlsPlayback();
              });

              // 先暴露真实 m3u8 source，供浏览器的投屏/外部播放器在
              // hls.js 将 video.currentSrc 切换为 blob: URL 前完成识别。
              video.hls = hls;
              ensureVideoSource(video, url);
              hls.loadSource(url);
              hls.attachMedia(video);

              if (isWebkit) {
                schedulePlayerTimeout(() => {
                  if (!shouldRescueWebkitHls(video)) {
                    return;
                  }

                  console.warn(
                    '[HLS] Safari attach watchdog triggered, forcing reattach'
                  );
                  try {
                    hls.detachMedia();
                    hls.attachMedia(video);
                    kickStartHlsPlayback();
                  } catch (error) {
                    console.warn('[HLS] Safari attach reattach failed:', error);
                  }
                }, 3000);
              }

              // 额外确保 iOS 内联播放属性（防止全屏时使用系统播放器）
              video.setAttribute('playsinline', 'true');
              video.setAttribute('webkit-playsinline', 'true');
              (video as any).playsInline = true;
              (video as any).webkitPlaysInline = true;

              // 监听Manifest加载完成事件，启动xiaoya链接定时刷新
              hls.on(Hls.Events.MANIFEST_PARSED, () => {
                console.log('[HLS] Manifest解析完成');

                const player = artPlayerRef.current;
                if (
                  video.paused &&
                  (player?.option.autoplay || player?.loading)
                ) {
                  try {
                    Promise.resolve(player?.play?.()).catch((error) => {
                      console.warn(
                        '[HLS] play after manifest parsed failed:',
                        error
                      );
                    });
                  } catch (error) {
                    console.warn(
                      '[HLS] play after manifest parsed failed:',
                      error
                    );
                  }
                }

                // 兜底：若 updateVideoUrl 时尚未启定时器，在 manifest 解析后再启
                // xiaoya：仅 m3u8；openlist：refresh14m 即可（此回调本身已在 HLS 路径）
                if (
                  isInitialLoadRef.current &&
                  currentXiaoyaUrlRef.current &&
                  shouldStartLinkRefreshTimer(url)
                ) {
                  isInitialLoadRef.current = false;
                  startRefreshTimer(hls, video);
                }
              });

              hls.on(Hls.Events.ERROR, function (event: any, data: any) {
                console.error('HLS Error:', event, data);
                if (data.fatal) {
                  switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                      // 检查是否是 manifest 加载错误（通常是 403/404/CORS 错误）
                      if (data.details === 'manifestLoadError') {
                        console.log(
                          'Manifest 加载失败：可能是 403/404 或 CORS 错误'
                        );

                        const statusCode =
                          data.response?.code || data.response?.status;

                        // 如果是403且是xiaoya源的m3u8，尝试自动刷新
                        if (statusCode === 403 && currentXiaoyaUrlRef.current) {
                          const isM3u8 =
                            url.includes('.m3u8') || url.includes('m3u8');
                          if (isM3u8) {
                            console.log('[HLS错误] 检测到403，尝试刷新链接');
                            refreshXiaoyaUrl(hls, video, false);
                            return; // 不执行后续的错误处理
                          }
                        }

                        // 原有的错误处理逻辑
                        hls.destroy();
                        if (statusCode === 403) {
                          setVideoError('访问被拒绝 (403)');
                        } else if (statusCode === 404) {
                          setVideoError('视频不存在 (404)');
                        } else if (statusCode === 415) {
                          setVideoError('视频格式不兼容 (415)');
                        } else if (statusCode) {
                          setVideoError(`HTTP ${statusCode} 错误`);
                        } else {
                          // CORS 错误或其他网络错误
                          // 如果是直链直连模式（URL 不含代理前缀），记录原始 URL 以便用户一键启用代理
                          if (
                            currentSourceRef.current === 'directplay' &&
                            !url.includes('/api/proxy-m3u8') &&
                            !url.includes('/api/proxy/vod/m3u8')
                          ) {
                            setCorsFailedUrl(url);
                          }
                          setVideoError(
                            '无法访问视频源（可能是跨域限制或访问被拒绝）'
                          );
                        }
                        return;
                      }
                      // 检查其他 HTTP 错误状态码
                      {
                        const statusCode =
                          data.response?.code || data.response?.status;
                        if (statusCode && statusCode >= 400) {
                          console.log(`HTTP ${statusCode} 错误`);
                          hls.destroy();
                          setVideoError(`HTTP ${statusCode} 错误`);
                          return;
                        }
                      }
                      console.log('网络错误，尝试恢复...');
                      hls.startLoad();
                      break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                      console.log('媒体错误，尝试恢复...');
                      hls.recoverMediaError();
                      break;
                    default:
                      console.log('无法恢复的错误');
                      hls.destroy();
                      setVideoError('视频加载错误');
                      break;
                  }
                }
              });
            },
          },
          plugins: [
            ...(!artplayerPluginAutoThumbnail
              ? []
              : [
                  artplayerPluginAutoThumbnail({
                    width: 160,
                    number: 100,
                    scale: 1,
                  }),
                ]),
            ...(artplayerPluginDanmuku ? [artplayerPluginDanmuku({
              danmuku: [],
              speed: danmakuSettingsRef.current.speed,
              opacity: danmakuSettingsRef.current.opacity,
              fontSize: danmakuSettingsRef.current.fontSize,
              color: '#FFFFFF',
              mode: 0,
              margin: [
                danmakuSettingsRef.current.marginTop,
                typeof danmakuSettingsRef.current.marginBottom === 'number'
                  ? danmakuSettingsRef.current.marginBottom
                  : `${Math.max(0, Math.min(100, parseFloat(danmakuSettingsRef.current.marginBottom) || 0))}%`,
              ],
              antiOverlap: true,
              synchronousPlayback:
                danmakuSettingsRef.current.synchronousPlayback,
              emitter: false,
              heatmap: false, // 禁用 artplayer 自带热力图，使用自定义热力图
              // 主题
              theme: 'dark',
              // 根据保存的显示状态设置初始可见性
              visible: danmakuDisplayStateRef.current,
              filter: (danmu: any) => {
                // 应用过滤规则
                const filterConfig = danmakuFilterConfigRef.current;
                if (filterConfig && filterConfig.rules.length > 0) {
                  for (const rule of filterConfig.rules) {
                    // 跳过未启用的规则
                    if (!rule.enabled) continue;

                    try {
                      if (rule.type === 'normal') {
                        // 普通模式：字符串包含匹配
                        if (danmu.text.includes(rule.keyword)) {
                          return false;
                        }
                      } else if (rule.type === 'regex') {
                        // 正则模式：正则表达式匹配
                        if (new RegExp(rule.keyword).test(danmu.text)) {
                          return false;
                        }
                      }
                    } catch (e) {
                      console.error('弹幕过滤规则错误:', e);
                    }
                  }
                }
                return true;
              },
            })] : []),
          ],
          icons: {
            loading:
              '<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MCIgaGVpZ2h0PSI1MCIgdmlld0JveD0iMCAwIDUwIDUwIj48cGF0aCBkPSJNMjUuMjUxIDYuNDYxYy0xMC4zMTggMC0xOC42ODMgOC4zNjUtMTguNjgzIDE4LjY4M2g0LjA2OGMwLTguMDcgNi41NDUtMTQuNjE1IDE0LjYxNS0xNC42MTVWNi40NjF6IiBmaWxsPSIjMDA5Njg4Ij48YW5pbWF0ZVRyYW5zZm9ybSBhdHRyaWJ1dGVOYW1lPSJ0cmFuc2Zvcm0iIGF0dHJpYnV0ZVR5cGU9IlhNTCIgZHVyPSIxcyIgZnJvbT0iMCAyNSAyNSIgcmVwZWF0Q291bnQ9ImluZGVmaW5pdGUiIHRvPSIzNjAgMjUgMjUiIHR5cGU9InJvdGF0ZSIvPjwvcGF0aD48L3N2Zz4=">',
          },
          settings: [
            {
              html: '去广告',
              icon: '<text x="50%" y="50%" font-size="20" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="#ffffff">AD</text>',
              tooltip: blockAdEnabled ? '已开启' : '已关闭',
              onClick() {
                const newVal = !blockAdEnabled;
                try {
                  localStorage.setItem('enable_blockad', String(newVal));
                  if (artPlayerRef.current) {
                    resumeTimeRef.current = artPlayerRef.current.currentTime;
                    if (
                      artPlayerRef.current.video &&
                      artPlayerRef.current.video.hls
                    ) {
                      artPlayerRef.current.video.hls.destroy();
                    }
                    artPlayerRef.current.destroy();
                    artPlayerRef.current = null;
                  }
                  setBlockAdEnabled(newVal);
                } catch {
                  // ignore
                }
                return newVal ? '当前开启' : '当前关闭';
              },
            },
            {
              html: '弹幕过滤',
              icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" fill="#ffffff"/><path d="M8 12h8" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/></svg>',
              tooltip: '配置弹幕过滤规则',
              onClick() {
                // 如果播放器处于全屏状态，先退出全屏
                if (artPlayerRef.current && artPlayerRef.current.fullscreen) {
                  artPlayerRef.current.fullscreen = false;
                  // 延迟一下再显示弹窗，确保全屏退出动画完成
                  setTimeout(() => {
                    setShowDanmakuFilterSettings(true);
                  }, 300);
                } else {
                  setShowDanmakuFilterSettings(true);
                }
                return '打开设置';
              },
            },
            // 热力图开关（仅在未禁用时显示）
            ...(!danmakuHeatmapDisabledRef.current
              ? [
                  {
                    name: '弹幕热力',
                    html: '弹幕热力',
                    icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z" fill="#ffffff"/></svg>',
                    switch: danmakuHeatmapEnabledRef.current,
                    onSwitch: function (item: any) {
                      const newVal = !item.switch;
                      try {
                        localStorage.setItem(
                          'danmaku_heatmap_enabled',
                          String(newVal)
                        );
                        setDanmakuHeatmapEnabled(newVal);
                        console.log('弹幕热力已', newVal ? '开启' : '关闭');
                      } catch (err) {
                        console.error('切换弹幕热力失败:', err);
                      }
                      return newVal;
                    },
                  },
                ]
              : []),
            ...(webGPUSupported
              ? [
                  {
                    name: 'Anime4K超分',
                    html: 'Anime4K超分',
                    icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5zm0 18c-4 0-7-3-7-7V9l7-3.5L19 9v4c0 4-3 7-7 7z" fill="#ffffff"/><path d="M10 12l2 2 4-4" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
                    switch: anime4kEnabledRef.current,
                    onSwitch: async function (item: any) {
                      const newVal = !item.switch;
                      await toggleAnime4K(newVal);
                      return newVal;
                    },
                  },
                  {
                    name: '超分模式',
                    html: '超分模式',
                    selector: [
                      {
                        html: 'ModeA (快速)',
                        value: 'ModeA',
                        default: anime4kModeRef.current === 'ModeA',
                      },
                      {
                        html: 'ModeB (平衡)',
                        value: 'ModeB',
                        default: anime4kModeRef.current === 'ModeB',
                      },
                      {
                        html: 'ModeC (质量)',
                        value: 'ModeC',
                        default: anime4kModeRef.current === 'ModeC',
                      },
                      {
                        html: 'ModeAA (增强快速)',
                        value: 'ModeAA',
                        default: anime4kModeRef.current === 'ModeAA',
                      },
                      {
                        html: 'ModeBB (增强平衡)',
                        value: 'ModeBB',
                        default: anime4kModeRef.current === 'ModeBB',
                      },
                      {
                        html: 'ModeCA (最高质量)',
                        value: 'ModeCA',
                        default: anime4kModeRef.current === 'ModeCA',
                      },
                    ],
                    onSelect: async function (item: any) {
                      await changeAnime4KMode(item.value);
                      return item.html;
                    },
                  },
                  {
                    name: '超分倍数',
                    html: '超分倍数',
                    selector: [
                      {
                        html: '1.5x',
                        value: '1.5',
                        default: anime4kScaleRef.current === 1.5,
                      },
                      {
                        html: '2.0x',
                        value: '2.0',
                        default: anime4kScaleRef.current === 2.0,
                      },
                      {
                        html: '3.0x',
                        value: '3.0',
                        default: anime4kScaleRef.current === 3.0,
                      },
                      {
                        html: '4.0x',
                        value: '4.0',
                        default: anime4kScaleRef.current === 4.0,
                      },
                    ],
                    onSelect: async function (item: any) {
                      await changeAnime4KScale(parseFloat(item.value));
                      return item.html;
                    },
                  },
                ]
              : []),
            {
              name: '跳过片头片尾',
              html: '跳过片头片尾',
              switch: skipConfigRef.current.enable,
              onSwitch: function (item) {
                const newConfig = {
                  ...skipConfigRef.current,
                  enable: !item.switch,
                };
                handleSkipConfigChange(newConfig);
                return !item.switch;
              },
            },
            {
              name: '快捷快进配置',
              html: '快捷快进配置',
              icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 5v14" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/><path d="m16 17 5-5-5-5" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 12H9" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/></svg>',
              tooltip: `${formatQuickForwardDuration(
                quickForwardSecondsRef.current
              )}`,
              onClick: async function () {
                const player = artPlayerRef.current;
                if (player?.fullscreen) {
                  player.fullscreen = false;
                  await new Promise((resolve) => setTimeout(resolve, 300));
                }

                const existingDialog = document.querySelector(
                  '.quick-forward-settings-dialog'
                );
                existingDialog?.remove();

                const container = document.createElement('div');
                container.className = 'quick-forward-settings-dialog';
                container.style.cssText = `
                  position: fixed;
                  inset: 0;
                  z-index: 10000;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  padding: 16px;
                  background: rgba(0, 0, 0, 0.6);
                  backdrop-filter: blur(3px);
                `;
                container.innerHTML = `
                  <div role="dialog" aria-modal="true" style="width: min(360px, 100%); background: #1f2937; color: #fff; border: 1px solid rgba(255,255,255,.12); border-radius: 12px; padding: 20px; box-shadow: 0 16px 48px rgba(0,0,0,.45);">
                    <div style="font-size: 17px; font-weight: 600; margin-bottom: 8px;">快捷快进设置</div>
                    <div style="color: #9ca3af; font-size: 13px; line-height: 1.5; margin-bottom: 16px;">设置点击底部按钮或按 P 键时向前跳转的时间。</div>
                    <label for="quick-forward-input" style="display: block; color: #d1d5db; font-size: 13px; margin-bottom: 6px;">快进时长（秒）</label>
                    <input id="quick-forward-input" type="number" min="1" step="1" value="${quickForwardSecondsRef.current}" style="box-sizing: border-box; width: 100%; height: 40px; padding: 0 10px; border: 1px solid #4b5563; border-radius: 6px; background: #111827; color: #fff; font-size: 14px; outline: none;" />
                    <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px;">
                      <button type="button" data-action="cancel" style="height: 36px; padding: 0 14px; border: 0; border-radius: 6px; background: #374151; color: #fff; cursor: pointer;">取消</button>
                      <button type="button" data-action="confirm" style="height: 36px; padding: 0 14px; border: 0; border-radius: 6px; background: #0d9488; color: #fff; cursor: pointer;">保存</button>
                    </div>
                  </div>
                `;
                document.body.appendChild(container);

                const input = container.querySelector(
                  '#quick-forward-input'
                ) as HTMLInputElement;
                const cancelButton = container.querySelector(
                  '[data-action="cancel"]'
                );
                const confirmButton = container.querySelector(
                  '[data-action="confirm"]'
                );
                const cleanup = () => container.remove();
                const save = () => {
                  const nextSeconds = Number(input.value);
                  if (!Number.isFinite(nextSeconds) || nextSeconds <= 0) {
                    input.focus();
                    if (artPlayerRef.current) {
                      artPlayerRef.current.notice.show =
                        '请输入大于 0 的有效秒数';
                    }
                    return;
                  }

                  const normalizedSeconds = Math.max(
                    1,
                    Math.round(nextSeconds)
                  );
                  setQuickForwardSeconds(normalizedSeconds);
                  quickForwardSecondsRef.current = normalizedSeconds;
                  localStorage.setItem(
                    'quickForwardSeconds',
                    String(normalizedSeconds)
                  );
                  if (artPlayerRef.current) {
                    artPlayerRef.current.notice.show = `快捷快进已设置为${formatQuickForwardDuration(
                      normalizedSeconds
                    )}`;
                  }
                  cleanup();
                };

                cancelButton?.addEventListener('click', cleanup);
                confirmButton?.addEventListener('click', save);
                container.addEventListener('click', (event) => {
                  if (event.target === container) cleanup();
                });
                input.addEventListener('keydown', (event) => {
                  if (event.key === 'Enter') save();
                  if (event.key === 'Escape') cleanup();
                });
                input.focus();
                input.select();
                return '打开设置';
              },
            },
            {
              name: '跳过配置',
              html: '跳过配置',
              icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>',
              tooltip:
                skipConfigRef.current.intro_time === 0 &&
                skipConfigRef.current.outro_time === 0
                  ? '设置跳过配置'
                  : `片头: ${formatTime(
                      skipConfigRef.current.intro_time
                    )} | 片尾: ${formatTime(
                      Math.abs(skipConfigRef.current.outro_time)
                    )}`,
              onClick: async function () {
                const player = artPlayerRef.current;
                if (player) {
                  // 如果处于全屏状态，先退出全屏
                  if (player.fullscreen) {
                    player.fullscreen = false;
                    // 等待全屏退出动画完成
                    await new Promise((resolve) => setTimeout(resolve, 300));
                  }

                  // 使用 ArtPlayer 的 prompt 功能创建输入弹窗
                  const currentIntro = skipConfigRef.current.intro_time || 0;
                  const currentOutro =
                    Math.abs(skipConfigRef.current.outro_time) || 0;

                  // 创建一个自定义的提示框
                  const container = document.createElement('div');
                  container.style.cssText = `
                  position: fixed;
                  top: 50%;
                  left: 50%;
                  transform: translate(-50%, -50%);
                  background: rgba(0, 0, 0, 0.9);
                  padding: 20px;
                  border-radius: 8px;
                  z-index: 9999;
                  min-width: 300px;
                  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
                `;

                  container.innerHTML = `
                  <div style="color: white; margin-bottom: 15px; font-size: 16px; font-weight: bold; border-bottom: 1px solid #444; padding-bottom: 10px;">
                    跳过配置
                  </div>
                  <div style="color: #aaa; font-size: 13px; margin-bottom: 15px; line-height: 1.5;">
                    设置片头片尾跳过时间，到达时间自动跳过
                  </div>
                  <div style="margin-bottom: 10px;">
                    <label style="color: white; display: block; margin-bottom: 5px; font-size: 14px; font-weight: 500;">
                      片头时间 (秒)
                      <span style="color: #888; font-size: 12px; font-weight: normal; margin-left: 8px;">从视频开始跳过的时长</span>
                    </label>
                    <div style="display: flex; gap: 8px;">
                      <input id="intro-input" type="number" min="0" step="1" value="${currentIntro}" placeholder="如: 90"
                             style="flex: 1; padding: 8px; border-radius: 4px; border: 1px solid #444; background: #222; color: white; font-size: 14px;" />
                      <button id="set-intro-btn" style="padding: 8px 12px; border-radius: 4px; border: none; background: #007bff; color: white; cursor: pointer; font-size: 14px; white-space: nowrap;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; margin-right: 4px;">
                          <circle cx="12" cy="12" r="10" stroke="white" stroke-width="2"/>
                          <path d="M12 6v6l4 4" stroke="white" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                        当前时间
                      </button>
                    </div>
                  </div>
                  <div style="margin-bottom: 15px;">
                    <label style="color: white; display: block; margin-bottom: 5px; font-size: 14px; font-weight: 500;">
                      片尾时间 (秒)
                      <span style="color: #888; font-size: 12px; font-weight: normal; margin-left: 8px;">从视频结尾向前跳过的时长</span>
                    </label>
                    <div style="display: flex; gap: 8px;">
                      <input id="outro-input" type="number" min="0" step="1" value="${currentOutro}" placeholder="如: 120"
                             style="flex: 1; padding: 8px; border-radius: 4px; border: 1px solid #444; background: #222; color: white; font-size: 14px;" />
                      <button id="set-outro-btn" style="padding: 8px 12px; border-radius: 4px; border: none; background: #007bff; color: white; cursor: pointer; font-size: 14px; white-space: nowrap;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; margin-right: 4px;">
                          <circle cx="12" cy="12" r="10" stroke="white" stroke-width="2"/>
                          <path d="M12 6v6l4 4" stroke="white" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                        当前时间
                      </button>
                    </div>
                  </div>
                  <div style="background: rgba(0, 123, 255, 0.1); border-left: 3px solid #007bff; padding: 10px; margin-bottom: 15px; border-radius: 4px;">
                    <div style="color: #88c0ff; font-size: 12px; line-height: 1.6;">
                      <div style="margin-bottom: 4px;">💡 <strong>提示：</strong></div>
                      <div>• 点击"当前时间"可快速设置为播放位置</div>
                      <div>• 片头90秒表示跳过前1分30秒</div>
                      <div>• 片尾120秒表示跳过最后2分钟</div>
                    </div>
                  </div>
                  <div style="display: flex; gap: 10px; justify-content: flex-end; border-top: 1px solid #444; padding-top: 15px;">
                    <button id="cancel-btn" style="padding: 8px 16px; border-radius: 4px; border: none; background: #444; color: white; cursor: pointer; font-size: 14px; transition: background 0.2s;" onmouseover="this.style.background='#555'" onmouseout="this.style.background='#444'">取消</button>
                    <button id="clear-btn" style="padding: 8px 16px; border-radius: 4px; border: none; background: #d9534f; color: white; cursor: pointer; font-size: 14px; transition: background 0.2s;" onmouseover="this.style.background='#c9302c'" onmouseout="this.style.background='#d9534f'">清除</button>
                    <button id="confirm-btn" style="padding: 8px 16px; border-radius: 4px; border: none; background: #5cb85c; color: white; cursor: pointer; font-size: 14px; transition: background 0.2s;" onmouseover="this.style.background='#4cae4c'" onmouseout="this.style.background='#5cb85c'">确定</button>
                  </div>
                `;

                  document.body.appendChild(container);

                  const introInput = container.querySelector(
                    '#intro-input'
                  ) as HTMLInputElement;
                  const outroInput = container.querySelector(
                    '#outro-input'
                  ) as HTMLInputElement;
                  const setIntroBtn = container.querySelector('#set-intro-btn');
                  const setOutroBtn = container.querySelector('#set-outro-btn');
                  const cancelBtn = container.querySelector('#cancel-btn');
                  const clearBtn = container.querySelector('#clear-btn');
                  const confirmBtn = container.querySelector('#confirm-btn');

                  const cleanup = () => {
                    document.body.removeChild(container);
                  };

                  // 设置片头为当前时间
                  setIntroBtn?.addEventListener('click', () => {
                    const currentTime = player.currentTime || 0;
                    if (currentTime > 0) {
                      introInput.value = Math.floor(currentTime).toString();
                    }
                  });

                  // 设置片尾为当前时间到结束的时长
                  setOutroBtn?.addEventListener('click', () => {
                    if (player.duration && player.currentTime) {
                      const outroTime = player.duration - player.currentTime;
                      if (outroTime > 0) {
                        outroInput.value = Math.floor(outroTime).toString();
                      }
                    }
                  });

                  cancelBtn?.addEventListener('click', cleanup);

                  clearBtn?.addEventListener('click', () => {
                    handleSkipConfigChange({
                      enable: false,
                      intro_time: 0,
                      outro_time: 0,
                    });
                    cleanup();
                  });

                  confirmBtn?.addEventListener('click', () => {
                    const introTime = parseFloat(introInput.value) || 0;
                    const outroTime = parseFloat(outroInput.value) || 0;

                    const newConfig = {
                      ...skipConfigRef.current,
                      intro_time: introTime,
                      outro_time: outroTime > 0 ? -outroTime : 0,
                    };

                    handleSkipConfigChange(newConfig);
                    cleanup();
                  });

                  // 支持 Enter 键确认
                  const handleEnter = (e: KeyboardEvent) => {
                    if (e.key === 'Enter') {
                      confirmBtn?.dispatchEvent(new Event('click'));
                    } else if (e.key === 'Escape') {
                      cancelBtn?.dispatchEvent(new Event('click'));
                    }
                  };

                  introInput.addEventListener('keydown', handleEnter);
                  outroInput.addEventListener('keydown', handleEnter);
                }
                return '';
              },
            },
          ],
          // 控制栏配置
          controls: [
            {
              position: 'left',
              index: 40,
              html: `<i class="art-icon flex quick-forward-control"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 5v14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="m16 17 5-5-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 12H9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></i>`,
              tooltip: '快捷快进',
              mounted: ($el: HTMLElement) => {
                $el.classList.add('quick-forward-control-wrapper');
                if (!document.getElementById('quick-forward-control-style')) {
                  const style = document.createElement('style');
                  style.id = 'quick-forward-control-style';
                  style.textContent = `
                    @media (max-width: 767px) and (orientation: portrait) {
                      .quick-forward-control-wrapper {
                        display: none !important;
                      }
                    }
                  `;
                  document.head.appendChild(style);
                }
              },
              click: function () {
                seekQuickForward();
              },
            },
            {
              position: 'left',
              index: 13,
              html: '<i class="art-icon flex"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" fill="currentColor"/></svg></i>',
              tooltip: '播放下一集',
              click: function () {
                // 房员禁用下一集按钮
                if (playSync.shouldDisableControls) {
                  if (artPlayerRef.current) {
                    artPlayerRef.current.notice.show =
                      '房员无法切换集数，请等待房主操作';
                  }
                  return;
                }
                handleNextEpisode();
              },
            },
            // iOS 设备上添加自定义全屏按钮（横屏和竖屏都显示）
            ...(isIOS
              ? [
                  {
                    position: 'right',
                    index: 100, // 大数字确保在设置按钮右边
                    html: '<i class="art-icon ios-portrait-fullscreen"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" fill="currentColor"/></svg></i>',
                    tooltip: '全屏',
                    style: {
                      color: '#fff',
                    },
                    mounted: function (_el: HTMLElement) {
                      // 添加 CSS 样式：横屏和竖屏都显示
                      const style = document.createElement('style');
                      style.textContent = `
                /* iOS 自定义全屏按钮在所有方向都显示 */
                .ios-portrait-fullscreen {
                  display: inline-flex !important;
                }
                /* iOS 全屏选择对话框样式（遵循项目统一风格） */
                .ios-fullscreen-dialog {
                  position: fixed;
                  top: 0;
                  left: 0;
                  right: 0;
                  bottom: 0;
                  background: rgba(0, 0, 0, 0.6);
                  backdrop-filter: blur(4px);
                  z-index: 1000;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  padding: 16px;
                }
                .ios-fullscreen-dialog-content {
                  background: white;
                  border-radius: 16px;
                  max-width: 480px;
                  width: 100%;
                  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
                  overflow: hidden;
                }
                .dark .ios-fullscreen-dialog-content {
                  background: rgb(31, 41, 55);
                }

                /* 标题栏 */
                .ios-fullscreen-dialog-header {
                  background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
                  padding: 20px 24px;
                }
                .ios-fullscreen-dialog-title {
                  font-size: 20px;
                  font-weight: 700;
                  color: white;
                  display: flex;
                  align-items: center;
                  gap: 10px;
                  margin-bottom: 6px;
                }
                .ios-fullscreen-dialog-title svg {
                  stroke: white;
                }
                .ios-fullscreen-dialog-subtitle {
                  font-size: 14px;
                  color: rgba(255, 255, 255, 0.9);
                  margin: 0;
                }

                /* 选项列表 */
                .ios-fullscreen-dialog-options {
                  padding: 16px;
                  display: flex;
                  flex-direction: column;
                  gap: 12px;
                }
                .ios-fullscreen-option {
                  display: flex;
                  align-items: center;
                  gap: 16px;
                  padding: 16px;
                  background: rgb(249, 250, 251);
                  border: 2px solid transparent;
                  border-radius: 12px;
                  cursor: pointer;
                  transition: all 0.2s;
                  text-align: left;
                }
                .dark .ios-fullscreen-option {
                  background: rgba(55, 65, 81, 0.5);
                }
                .ios-fullscreen-option:hover {
                  background: rgb(243, 244, 246);
                  border-color: #22c55e;
                  box-shadow: 0 4px 12px rgba(34, 197, 94, 0.15);
                }
                .dark .ios-fullscreen-option:hover {
                  background: rgb(55, 65, 81);
                }
                .ios-fullscreen-option:active {
                  transform: scale(0.98);
                }

                /* 推荐选项 */
                .ios-fullscreen-option-recommended {
                  border-color: #22c55e;
                }

                /* 选项图标 */
                .ios-fullscreen-option-icon {
                  flex-shrink: 0;
                  width: 48px;
                  height: 48px;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  background: white;
                  border-radius: 10px;
                  color: #22c55e;
                }
                .dark .ios-fullscreen-option-icon {
                  background: rgb(31, 41, 55);
                }
                .ios-fullscreen-option-recommended .ios-fullscreen-option-icon {
                  background: #22c55e;
                  color: white;
                }

                /* 选项内容 */
                .ios-fullscreen-option-content {
                  flex: 1;
                }
                .ios-fullscreen-option-title {
                  font-size: 16px;
                  font-weight: 600;
                  color: rgb(17, 24, 39);
                  margin-bottom: 4px;
                  display: flex;
                  align-items: center;
                  gap: 8px;
                }
                .dark .ios-fullscreen-option-title {
                  color: white;
                }
                .ios-fullscreen-option-badge {
                  display: inline-block;
                  padding: 2px 8px;
                  background: #22c55e;
                  color: white;
                  font-size: 12px;
                  font-weight: 500;
                  border-radius: 4px;
                }
                .ios-fullscreen-option-desc {
                  font-size: 13px;
                  color: rgb(107, 114, 128);
                  line-height: 1.4;
                }
                .dark .ios-fullscreen-option-desc {
                  color: rgb(156, 163, 175);
                }

                /* 箭头图标 */
                .ios-fullscreen-option-arrow {
                  flex-shrink: 0;
                  color: rgb(209, 213, 219);
                  transition: transform 0.2s;
                }
                .dark .ios-fullscreen-option-arrow {
                  color: rgb(75, 85, 99);
                }
                .ios-fullscreen-option:hover .ios-fullscreen-option-arrow {
                  transform: translateX(4px);
                  color: #22c55e;
                }

                /* 底部提示 */
                .ios-fullscreen-dialog-footer {
                  padding: 16px 24px;
                  background: rgb(249, 250, 251);
                  border-top: 1px solid rgb(229, 231, 235);
                  display: flex;
                  align-items: flex-start;
                  gap: 10px;
                  font-size: 12px;
                  color: rgb(107, 114, 128);
                  line-height: 1.5;
                }
                .dark .ios-fullscreen-dialog-footer {
                  background: rgba(17, 24, 39, 0.5);
                  border-top-color: rgb(55, 65, 81);
                  color: rgb(156, 163, 175);
                }
                .ios-fullscreen-dialog-footer svg {
                  flex-shrink: 0;
                  margin-top: 2px;
                  stroke: currentColor;
                }
              `;
                      document.head.appendChild(style);
                    },
                    click: function () {
                      if (!artPlayerRef.current) return;

                      // 检测是否在 PWA 模式下
                      const isPWA =
                        window.matchMedia('(display-mode: standalone)')
                          .matches ||
                        window.matchMedia('(display-mode: fullscreen)')
                          .matches ||
                        (window.navigator as any).standalone === true;

                      // 检查是否已经在原生全屏状态
                      const isInNativeFullscreen = !!(
                        document.fullscreenElement ||
                        (document as any).webkitFullscreenElement
                      );

                      // 如果已经在原生全屏状态，退出原生全屏
                      if (isInNativeFullscreen) {
                        const exitFullscreen =
                          (document as any).exitFullscreen ||
                          (document as any).webkitExitFullscreen ||
                          (document as any).mozCancelFullScreen ||
                          (document as any).msExitFullscreen;
                        if (exitFullscreen) {
                          try {
                            const result = exitFullscreen.call(document);
                            if (result && typeof result.catch === 'function') {
                              result.catch((err: Error) =>
                                console.error('退出全屏失败:', err)
                              );
                            }
                          } catch (err) {
                            console.error('退出全屏失败:', err);
                          }
                        }
                        return;
                      }

                      // 如果已经在网页全屏状态，退出网页全屏
                      if (artPlayerRef.current.fullscreenWeb) {
                        artPlayerRef.current.fullscreenWeb = false;
                        return;
                      }

                      // 如果在 PWA 模式下，直接使用容器全屏（可以隐藏状态栏）
                      if (isPWA) {
                        const container =
                          artPlayerRef.current.template.$container;
                        if (container && container.webkitEnterFullscreen) {
                          container
                            .webkitEnterFullscreen()
                            .catch((err: Error) => {
                              console.error('PWA 全屏失败:', err);
                              // 如果失败，降级使用网页全屏
                              artPlayerRef.current.fullscreenWeb = true;
                            });
                        } else {
                          // 不支持原生全屏，使用网页全屏
                          artPlayerRef.current.fullscreenWeb = true;
                        }
                        return;
                      }

                      // 非 PWA 模式：创建对话框（使用项目统一风格）
                      const dialog = document.createElement('div');
                      dialog.className = 'ios-fullscreen-dialog';
                      dialog.innerHTML = `
                <div class="ios-fullscreen-dialog-content">
                  <!-- 标题栏 -->
                  <div class="ios-fullscreen-dialog-header">
                    <h3 class="ios-fullscreen-dialog-title">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" stroke="currentColor" stroke-width="2" fill="none"/>
                      </svg>
                      选择全屏模式
                    </h3>
                    <p class="ios-fullscreen-dialog-subtitle">
                      由于 iOS 系统限制，原生全屏会使用系统播放器，将无法显示弹幕及使用部分播放器功能。网页全屏可能无法完全占满屏幕，但可保留所有功能。
                    </p>
                  </div>

                  <!-- 选项列表 -->
                  <div class="ios-fullscreen-dialog-options">
                    <!-- 网页全屏选项 -->
                    <button class="ios-fullscreen-option ios-fullscreen-option-recommended" data-action="web">
                      <div class="ios-fullscreen-option-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/>
                          <path d="M7 10h2v7H7zm4-3h2v10h-2zm4 6h2v4h-2z" fill="currentColor"/>
                        </svg>
                      </div>
                      <div class="ios-fullscreen-option-content">
                        <div class="ios-fullscreen-option-title">
                          网页全屏
                          <span class="ios-fullscreen-option-badge">推荐</span>
                        </div>
                        <div class="ios-fullscreen-option-desc">
                          保留弹幕、控制栏等所有功能
                        </div>
                      </div>
                      <svg class="ios-fullscreen-option-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none">
                        <path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                      </svg>
                    </button>

                    <!-- 原生全屏选项 -->
                    <button class="ios-fullscreen-option" data-action="native">
                      <div class="ios-fullscreen-option-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" stroke="currentColor" stroke-width="2"/>
                        </svg>
                      </div>
                      <div class="ios-fullscreen-option-content">
                        <div class="ios-fullscreen-option-title">
                          原生全屏
                        </div>
                        <div class="ios-fullscreen-option-desc">
                          使用系统播放器，部分功能不可用
                        </div>
                      </div>
                      <svg class="ios-fullscreen-option-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none">
                        <path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                      </svg>
                    </button>
                  </div>

                  <!-- 底部提示 -->
                  <div class="ios-fullscreen-dialog-footer">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
                      <path d="M12 16v-4m0-4h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                    <span>将网站添加到主屏幕（PWA）后，网页全屏可以完全全屏</span>
                  </div>
                </div>
              `;

                      // 添加到页面
                      document.body.appendChild(dialog);

                      // 点击背景关闭
                      dialog.addEventListener('click', (e) => {
                        if (e.target === dialog) {
                          document.body.removeChild(dialog);
                        }
                      });

                      // 按钮点击事件
                      const buttons = dialog.querySelectorAll(
                        '.ios-fullscreen-option'
                      );
                      buttons.forEach((button) => {
                        button.addEventListener('click', () => {
                          const action = button.getAttribute('data-action');

                          if (action === 'web') {
                            // 网页全屏
                            if (artPlayerRef.current) {
                              artPlayerRef.current.fullscreenWeb = true;
                            }
                          } else if (action === 'native') {
                            // 原生全屏（尝试使用浏览器的全屏 API）
                            if (
                              artPlayerRef.current &&
                              artPlayerRef.current.template.$video
                            ) {
                              const videoElement =
                                artPlayerRef.current.template.$video;
                              if (videoElement.requestFullscreen) {
                                videoElement.requestFullscreen();
                              } else if (
                                (videoElement as any).webkitEnterFullscreen
                              ) {
                                (videoElement as any).webkitEnterFullscreen();
                              }
                            }
                          }

                          // 关闭对话框
                          document.body.removeChild(dialog);
                        });
                      });
                    },
                  },
                ]
              : []),
          ],
        });

        const eventPlayer = artPlayerRef.current;
        activeMediaRef.current = { player: eventPlayer, revision: videoProgressRevision, url: videoUrl, started: false, resetPosition: false };
        eventPlayer.on('video:loadstart', () => {
          if (isCurrentMedia(eventPlayer)) activeMediaRef.current!.started = true;
        });
        artPlayerRef.current.on('destroy', () => {
          clearPlayerTimeouts();
        });

        artPlayerRef.current.on('flip', syncAnime4KCanvasFlip);

        // 监听播放器事件
        artPlayerRef.current.on('ready', async () => {
          if (!isCurrentMedia(eventPlayer)) return;
          const readyMedia = activeMediaRef.current;
          setError(null);

          rescueWebkitHlsBootstrap('player-ready');

          // 标记播放器已就绪，触发 usePlaySync 设置事件监听器
          setPlayerReady(true);
          console.log('[PlayPage] Player ready, triggering sync setup');

          // 应用进度条图标配置 - 尽早执行
          const applyProgressThumbConfig = () => {
            try {
              const config = (window as any).RUNTIME_CONFIG;

              if (!config || config.PROGRESS_THUMB_TYPE === 'default') {
                // 使用默认样式，移除自定义样式
                const oldStyle = document.getElementById(
                  'custom-progress-thumb-style'
                );
                if (oldStyle) oldStyle.remove();
                return;
              }

              let thumbUrl = '';
              let thumbColor = '#22c55e'; // 默认绿色

              if (
                config.PROGRESS_THUMB_TYPE === 'preset' &&
                config.PROGRESS_THUMB_PRESET_ID
              ) {
                const presetConfig: Record<
                  string,
                  { url: string; color: string }
                > = {
                  renako: { url: '/icons/q/renako.png', color: '#ec4899' }, // 粉色
                  irena: { url: '/icons/q/irena.png', color: '#f8fafc' }, // 雪白色
                  emilia: { url: '/icons/q/emilia.png', color: '#f8fafc' }, // 雪白色
                };
                const preset = presetConfig[config.PROGRESS_THUMB_PRESET_ID];
                if (preset) {
                  thumbUrl = preset.url;
                  thumbColor = preset.color;
                }
              } else if (
                config.PROGRESS_THUMB_TYPE === 'custom' &&
                config.PROGRESS_THUMB_CUSTOM_URL
              ) {
                thumbUrl = config.PROGRESS_THUMB_CUSTOM_URL;
              }

              // 修改 ArtPlayer 的主题色
              if (artPlayerRef.current) {
                artPlayerRef.current.theme = thumbColor;
              }

              if (thumbUrl) {
                // 根据预设ID确定尺寸
                let width = '30px';
                let height = '30px';
                let marginLeft = '-15px';

                // renako 图标特殊处理（288x404比例，放大1.25倍）
                if (
                  config.PROGRESS_THUMB_TYPE === 'preset' &&
                  config.PROGRESS_THUMB_PRESET_ID === 'renako'
                ) {
                  width = '26.875px'; // 21.5 * 1.25
                  height = '37.5px'; // 30 * 1.25
                  marginLeft = '-13.4375px'; // 10.75 * 1.25
                }

                // 动态设置背景图片
                const style = document.createElement('style');
                style.id = 'custom-progress-thumb-style';
                style.textContent = `
                /* 替换默认的进度条圆点为自定义图标 */
                .art-video-player .art-progress-indicator {
                  width: ${width} !important;
                  height: ${height} !important;
                  background-image: url('${thumbUrl}') !important;
                  background-size: contain !important;
                  background-repeat: no-repeat !important;
                  background-position: center !important;
                  background-color: transparent !important;
                  border-radius: 0 !important;
                  margin-left: ${marginLeft} !important;
                }
              `;

                // 移除旧样式
                const oldStyle = document.getElementById(
                  'custom-progress-thumb-style'
                );
                if (oldStyle) oldStyle.remove();

                document.head.appendChild(style);
              }
            } catch (error) {
              console.error('[进度条图标] 应用配置失败:', error);
            }
          };

          applyProgressThumbConfig();

          // 添加字幕切换和本地字幕上传功能；ASS/SSA 需要播放器 ready 后挂载 JASSUB
          const readySubtitles = (detailRef.current?.subtitles?.[
            currentEpisodeIndexRef.current
          ] || []) as SourceSubtitleItem[];
          const readyDefaultSubtitle = readySubtitles[0];
          if (
            readyDefaultSubtitle &&
            isAdvancedSourceSubtitle(readyDefaultSubtitle)
          ) {
            void switchSourceSubtitle(readyDefaultSubtitle)
              .catch((error) => {
                console.warn('[Subtitle] 高级字幕自动加载失败:', error);
                if (artPlayerRef.current) {
                  artPlayerRef.current.subtitle.show = false;
                }
                currentSubtitleLabelRef.current = '关闭';
              })
              .finally(updateSubtitleSetting);
          } else {
            updateSubtitleSetting();
          }

          // 添加字幕大小设置
          if (artPlayerRef.current) {
            const savedSubtitleSize =
              typeof window !== 'undefined'
                ? localStorage.getItem('subtitleSize') || '2em'
                : '2em';
            const defaultOption =
              savedSubtitleSize === '1em'
                ? '小'
                : savedSubtitleSize === '3em'
                ? '大'
                : savedSubtitleSize === '4em'
                ? '超大'
                : '中';

            artPlayerRef.current.setting.add({
              html: '字幕大小',
              selector: [
                { html: '小', size: '1em' },
                { html: '中', size: '2em' },
                { html: '大', size: '3em' },
                { html: '超大', size: '4em' },
              ],
              onSelect: function (item: any) {
                if (artPlayerRef.current) {
                  artPlayerRef.current.subtitle.style({
                    fontSize: item.size,
                  });
                  // 保存到 localStorage
                  if (typeof window !== 'undefined') {
                    localStorage.setItem('subtitleSize', item.size);
                  }
                }
                return item.html;
              },
              default: defaultOption,
            });
          }

          // 控制截图按钮在小屏幕竖屏时隐藏
          const updateScreenshotVisibility = () => {
            const screenshotBtn = document.querySelector(
              '.art-control-screenshot'
            ) as HTMLElement;
            if (screenshotBtn) {
              const isPortrait = window.innerHeight > window.innerWidth;
              const isSmallScreen = window.innerWidth < 768;
              screenshotBtn.style.display =
                isPortrait && isSmallScreen ? 'none' : '';
            }
          };
          updateScreenshotVisibility();
          window.addEventListener('resize', updateScreenshotVisibility);
          artPlayerRef.current.on('fullscreen', updateScreenshotVisibility);
          artPlayerRef.current.on('fullscreenWeb', updateScreenshotVisibility);

          // iOS 设备：动态调整弹幕设置面板位置，避免被遮挡
          if (isIOS && artPlayerRef.current) {
            // 使用 MutationObserver 监听弹幕设置面板的显示
            let isAdjusting = false; // 防止重复调整的标记
            const observer = new MutationObserver(() => {
              if (isAdjusting) return; // 如果正在调整，跳过

              const panel = document.querySelector(
                '.apd-config-panel'
              ) as HTMLElement;
              if (panel && panel.style.display !== 'none') {
                // 获取当前的 left 值
                const currentLeft = parseInt(panel.style.left || '0', 10);

                // 如果 left 值异常小（iOS 上只有 -5px），调整为正常值（-246px，比标准位置再往左 100px）
                if (currentLeft > -50) {
                  isAdjusting = true; // 设置标记，防止重复触发
                  const adjustedLeft = -246;
                  panel.style.left = `${adjustedLeft}px`;
                  console.log(
                    '[iOS] 已调整弹幕设置面板位置: 从',
                    currentLeft,
                    '调整为',
                    adjustedLeft
                  );

                  // 延迟重置标记
                  setTimeout(() => {
                    isAdjusting = false;
                  }, 100);
                }
              }
            });

            // 监听整个播放器容器的 DOM 变化
            if (artRef.current) {
              observer.observe(artRef.current, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['style', 'class'],
              });
            }

            // 清理函数
            artPlayerRef.current.on('destroy', () => {
              observer.disconnect();
            });
          }

          // iOS 设备：监听屏幕方向变化，自动调整全屏状态
          if (isIOS && artPlayerRef.current) {
            const handleOrientationChange = () => {
              if (!artPlayerRef.current) return;

              // 获取当前屏幕方向
              const isLandscape = window.matchMedia(
                '(orientation: landscape)'
              ).matches;
              const isPortrait = window.matchMedia(
                '(orientation: portrait)'
              ).matches;

              console.log('[iOS] 屏幕方向变化:', {
                isLandscape,
                isPortrait,
                fullscreenWeb: artPlayerRef.current.fullscreenWeb,
              });

              // 如果在网页全屏状态下旋转到横屏，切换到正常全屏
              if (artPlayerRef.current.fullscreenWeb && isLandscape) {
                console.log('[iOS] 横屏模式：从网页全屏切换到正常全屏');
                // 先退出网页全屏
                artPlayerRef.current.fullscreenWeb = false;
                // 延迟一下再进入正常全屏，确保布局已更新
                setTimeout(() => {
                  if (artPlayerRef.current) {
                    artPlayerRef.current.fullscreenWeb = true;
                  }
                }, 100);
              }
            };

            // 监听屏幕方向变化
            window.addEventListener(
              'orientationchange',
              handleOrientationChange
            );
            // 也监听 resize 事件（某些设备上更可靠）
            window.addEventListener('resize', handleOrientationChange);

            // 清理函数
            artPlayerRef.current.on('destroy', () => {
              window.removeEventListener(
                'orientationchange',
                handleOrientationChange
              );
              window.removeEventListener('resize', handleOrientationChange);
            });
          }

          // 从 art.storage 读取弹幕设置并应用
          if (artPlayerRef.current) {
            const storedDanmakuSettings =
              artPlayerRef.current.storage.get('danmaku_settings');
            if (storedDanmakuSettings) {
              // 合并存储的设置到当前设置
              const mergedSettings = {
                ...danmakuSettingsRef.current,
                ...storedDanmakuSettings,
              };
              setDanmakuSettings(mergedSettings);
              saveDanmakuSettings(mergedSettings);
            }
          }

          // 保存弹幕插件引用
          if (artPlayerRef.current?.plugins?.artplayerPluginDanmuku) {
            danmakuPluginRef.current =
              artPlayerRef.current.plugins.artplayerPluginDanmuku;

            // 监听弹幕配置变化事件
            artPlayerRef.current.on('artplayerPluginDanmuku:config', () => {
              if (danmakuPluginRef.current?.option) {
                const newSettings = {
                  ...danmakuSettingsRef.current,
                  opacity:
                    danmakuPluginRef.current.option.opacity ||
                    danmakuSettingsRef.current.opacity,
                  fontSize:
                    danmakuPluginRef.current.option.fontSize ||
                    danmakuSettingsRef.current.fontSize,
                  speed:
                    danmakuPluginRef.current.option.speed ||
                    danmakuSettingsRef.current.speed,
                  marginTop:
                    (danmakuPluginRef.current.option.margin &&
                      danmakuPluginRef.current.option.margin[0]) ??
                    danmakuSettingsRef.current.marginTop,
                  marginBottom:
                    (danmakuPluginRef.current.option.margin &&
                      danmakuPluginRef.current.option.margin[1]) ??
                    danmakuSettingsRef.current.marginBottom,
                };

                // 保存到 localStorage 和 art.storage
                setDanmakuSettings(newSettings);
                saveDanmakuSettings(newSettings);
                if (artPlayerRef.current?.storage) {
                  artPlayerRef.current.storage.set(
                    'danmaku_settings',
                    newSettings
                  );
                }

                console.log('弹幕设置已更新并保存:', newSettings);
              }
            });

            // 自动搜索并加载弹幕
            await autoSearchDanmaku();
            if (readyMedia !== activeMediaRef.current || !isCurrentMedia(eventPlayer)) return;

            if (artPlayerRef.current) {
              // 监听弹幕显示/隐藏事件，保存开关状态到 localStorage
              artPlayerRef.current.on('artplayerPluginDanmuku:show', () => {
                danmakuDisplayStateRef.current = true;
                saveDanmakuDisplayState(true);
              });

              artPlayerRef.current.on('artplayerPluginDanmuku:hide', () => {
                danmakuDisplayStateRef.current = false;
                saveDanmakuDisplayState(false);
              });
            }
          }

          // 播放器就绪后，如果正在播放则请求 Wake Lock
          if (artPlayerRef.current && !artPlayerRef.current.paused) {
            requestWakeLock();
          }
        });

        // 监听播放状态变化，控制 Wake Lock
        artPlayerRef.current.on('play', () => {
          requestWakeLock();
        });

        artPlayerRef.current.on('pause', () => {
          releaseWakeLock();
          saveCurrentPlayProgress();
        });

        artPlayerRef.current.on('video:ended', () => {
          releaseWakeLock();
        });

        // 如果播放器初始化时已经在播放状态，则请求 Wake Lock
        if (artPlayerRef.current && !artPlayerRef.current.paused) {
          requestWakeLock();
        }

        artPlayerRef.current.on('video:volumechange', () => {
          lastVolumeRef.current = artPlayerRef.current.volume;
        });
        artPlayerRef.current.on('video:ratechange', () => {
          const currentRate = artPlayerRef.current.playbackRate;
          const shouldIgnoreSafariReset =
            isWebkit &&
            Date.now() < playbackRateRestoreWindowUntilRef.current &&
            Math.abs(currentRate - 1) < 0.01 &&
            lastPlaybackRateRef.current > 1;

          if (shouldIgnoreSafariReset) {
            // Safari 切集后可能偷偷回到 1x，这不是用户真实选择，不要覆盖记忆值。
            schedulePlayerTimeout(() => {
              if (
                artPlayerRef.current &&
                Math.abs(
                  artPlayerRef.current.playbackRate -
                    lastPlaybackRateRef.current
                ) > 0.01
              ) {
                artPlayerRef.current.playbackRate = lastPlaybackRateRef.current;
              }
            }, 0);
            syncPlaybackPitch();
            return;
          }

          lastPlaybackRateRef.current = currentRate;
          persistPlaybackRate(currentRate);
          syncPlaybackPitch();
        });
        artPlayerRef.current.on('video:playing', () => {
          if (
            isWebkit &&
            Date.now() < playbackRateRestoreWindowUntilRef.current &&
            Math.abs(
              artPlayerRef.current.playbackRate - lastPlaybackRateRef.current
            ) > 0.01
          ) {
            artPlayerRef.current.playbackRate = lastPlaybackRateRef.current;
          }
        });

        // 监听网页全屏事件，控制导航栏显示隐藏
        artPlayerRef.current.on('fullscreenWeb', (isFullscreen: boolean) => {
          console.log('网页全屏状态变化:', isFullscreen);
          setIsWebFullscreen(isFullscreen);
        });

        // 添加自定义热力图到播放器控制层
        if (!danmakuHeatmapDisabledRef.current) {
          artPlayerRef.current.controls.add({
            name: 'custom-heatmap',
            position: 'top',
            html: '<canvas id="custom-heatmap-canvas" style="width: 100%; height: 100%; display: block;"></canvas>',
            style: {
              position: 'absolute',
              bottom: '5px',
              left: '0',
              height: '60px',
              pointerEvents: 'none',
              zIndex: '30',
              display: danmakuHeatmapEnabledRef.current ? 'block' : 'none',
            },
            mounted: ($el: HTMLElement) => {
              const canvas = $el.querySelector(
                '#custom-heatmap-canvas'
              ) as HTMLCanvasElement;
              if (!canvas) {
                return;
              }

              // 根据实际显示尺寸和设备像素比设置 canvas 分辨率
              const updateCanvasSize = () => {
                const rect = canvas.getBoundingClientRect();
                const dpr = window.devicePixelRatio || 1;
                const newWidth = Math.round(rect.width * dpr);
                const newHeight = Math.round(rect.height * dpr);

                // 只在尺寸真正改变时才更新，避免闪烁
                if (canvas.width !== newWidth || canvas.height !== newHeight) {
                  canvas.width = newWidth;
                  canvas.height = newHeight;
                  return true; // 返回 true 表示尺寸已更新
                }
                return false; // 返回 false 表示尺寸未变化
              };

              // 动态获取进度条的实际位置并调整热力图
              const adjustHeatmapPosition = () => {
                const progressBar = document.querySelector(
                  '.art-control-progress'
                ) as HTMLElement;

                if (!progressBar) {
                  return;
                }

                if (!$el.parentElement) {
                  return;
                }

                if (progressBar && $el.parentElement) {
                  const rect = progressBar.getBoundingClientRect();
                  const parentRect = $el.parentElement.getBoundingClientRect();

                  // 调整热力图位置以完全匹配进度条
                  $el.style.left = `${rect.left - parentRect.left}px`;
                  $el.style.bottom = `${parentRect.bottom - rect.bottom + 5}px`;
                  $el.style.width = `${rect.width}px`;

                  // 更新 canvas 分辨率
                  updateCanvasSize();
                }
              };

              // 初始调整
              setTimeout(adjustHeatmapPosition, 500);

              // 监听进度条尺寸变化
              const progressBar = document.querySelector(
                '.art-control-progress'
              ) as HTMLElement;
              let progressResizeObserver: ResizeObserver | null = null;
              if (progressBar && typeof ResizeObserver !== 'undefined') {
                progressResizeObserver = new ResizeObserver(() => {
                  adjustHeatmapPosition();
                  // 进度条长度变化时也需要重新计算和绘制热力图
                  setTimeout(updateHeatmapData, 100);
                });
                progressResizeObserver.observe(progressBar);
              }

              // 监听全屏状态变化
              if (artPlayerRef.current) {
                artPlayerRef.current.on('fullscreen', () => {
                  setTimeout(adjustHeatmapPosition, 300);
                });

                artPlayerRef.current.on('fullscreenWeb', () => {
                  setTimeout(adjustHeatmapPosition, 300);
                });
              }

              // 监听窗口大小变化
              const resizeHandler = () => {
                adjustHeatmapPosition();
              };
              window.addEventListener('resize', resizeHandler);

              let heatmapData: number[] = [];
              let hoverTime = 0;
              let tooltipEl: HTMLElement | null = null;

              // 监听热力图开关状态变化
              let lastEnabled =
                localStorage.getItem('danmaku_heatmap_enabled') === 'true';
              const updateVisibility = () => {
                const enabled =
                  localStorage.getItem('danmaku_heatmap_enabled') === 'true';

                // 只在状态真正改变时才更新 DOM
                if (enabled !== lastEnabled) {
                  $el.style.display = enabled ? 'block' : 'none';

                  // 如果从关闭变为打开，重新调整位置和尺寸
                  if (enabled) {
                    setTimeout(() => {
                      adjustHeatmapPosition();
                      drawHeatmap();
                    }, 50);
                  }

                  lastEnabled = enabled;
                }
              };

              // 定期检查开关状态
              const visibilityInterval = setInterval(updateVisibility, 500);

              // 计算热力图数据（按视频长度的5%分段，使热力图更平滑）
              const calculateHeatmapData = (
                danmakuList: any[],
                duration: number
              ) => {
                if (!duration || duration <= 0 || danmakuList.length === 0) {
                  return [];
                }

                // 按视频长度的5%分段，最少20段
                const segments = Math.max(20, Math.ceil(duration * 0.05));
                const segmentDuration = duration / segments;
                const heatData = new Array(segments).fill(0);

                danmakuList.forEach((danmaku: any) => {
                  const segmentIndex = Math.floor(
                    danmaku.time / segmentDuration
                  );
                  if (segmentIndex >= 0 && segmentIndex < segments) {
                    heatData[segmentIndex]++;
                  }
                });

                const maxCount = Math.max(...heatData, 1);
                return heatData.map((count: number) => count / maxCount);
              };

              // 绘制热力图
              const drawHeatmap = () => {
                // 检查热力图是否启用（与初始状态逻辑保持一致）
                const storedValue = localStorage.getItem(
                  'danmaku_heatmap_enabled'
                );
                const enabled =
                  storedValue !== null ? storedValue === 'true' : true; // 默认开启
                if (!enabled) {
                  // 热力图已关闭，跳过绘制
                  return;
                }

                if (!artPlayerRef.current) {
                  return;
                }

                if (heatmapData.length === 0) {
                  return;
                }

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                  return;
                }

                const dpr = window.devicePixelRatio || 1;
                const width = canvas.width / dpr;
                const height = canvas.height / dpr;
                const duration = artPlayerRef.current.duration || 0;
                const currentTime = artPlayerRef.current.currentTime || 0;

                ctx.save();
                ctx.scale(dpr, dpr);
                ctx.clearRect(0, 0, width, height);

                const progressRatio = duration > 0 ? currentTime / duration : 0;
                const progressX = progressRatio * width;

                // 绘制未播放部分的曲线
                ctx.beginPath();
                ctx.moveTo(0, height);

                heatmapData.forEach((value: number, index: number) => {
                  const x = (index / heatmapData.length) * width;
                  const y = height - value * height;

                  if (index === 0) {
                    ctx.lineTo(x, y);
                  } else {
                    // 使用二次贝塞尔曲线使线条平滑
                    const prevX = ((index - 1) / heatmapData.length) * width;
                    const prevY = height - heatmapData[index - 1] * height;
                    const cpX = (prevX + x) / 2;
                    const cpY = (prevY + y) / 2;
                    ctx.quadraticCurveTo(prevX, prevY, cpX, cpY);
                    ctx.lineTo(x, y);
                  }
                });

                ctx.lineTo(width, height);
                ctx.closePath();
                ctx.fillStyle = 'rgba(128, 128, 128, 0.3)';
                ctx.fill();

                // 绘制已播放部分的曲线（深色）
                if (progressRatio > 0) {
                  ctx.save();
                  ctx.beginPath();
                  ctx.rect(0, 0, progressX, height);
                  ctx.clip();

                  ctx.beginPath();
                  ctx.moveTo(0, height);

                  heatmapData.forEach((value: number, index: number) => {
                    const x = (index / heatmapData.length) * width;
                    const y = height - value * height;

                    if (index === 0) {
                      ctx.lineTo(x, y);
                    } else {
                      const prevX = ((index - 1) / heatmapData.length) * width;
                      const prevY = height - heatmapData[index - 1] * height;
                      const cpX = (prevX + x) / 2;
                      const cpY = (prevY + y) / 2;
                      ctx.quadraticCurveTo(prevX, prevY, cpX, cpY);
                      ctx.lineTo(x, y);
                    }
                  });

                  ctx.lineTo(width, height);
                  ctx.closePath();
                  ctx.fillStyle = 'rgba(128, 128, 128, 0.6)';
                  ctx.fill();

                  ctx.restore();
                }

                ctx.restore();
              };

              // 格式化时间
              const formatTime = (seconds: number): string => {
                const h = Math.floor(seconds / 3600);
                const m = Math.floor((seconds % 3600) / 60);
                const s = Math.floor(seconds % 60);

                if (h > 0) {
                  return `${h}:${m.toString().padStart(2, '0')}:${s
                    .toString()
                    .padStart(2, '0')}`;
                }
                return `${m}:${s.toString().padStart(2, '0')}`;
              };

              // 获取弹幕密度
              const getDensity = (time: number): string => {
                if (heatmapData.length === 0 || !artPlayerRef.current)
                  return '';
                const duration = artPlayerRef.current.duration || 0;
                if (duration <= 0) return '';

                // 按视频长度的5%分段
                const segments = Math.max(20, Math.ceil(duration * 0.05));
                const segmentDuration = duration / segments;
                const segmentIndex = Math.floor(time / segmentDuration);

                if (segmentIndex >= 0 && segmentIndex < heatmapData.length) {
                  const density = heatmapData[segmentIndex];
                  if (density < 0.2) return '低';
                  if (density < 0.5) return '中';
                  if (density < 0.8) return '高';
                  return '极高';
                }
                return '';
              };

              // 鼠标移动事件
              canvas.addEventListener('mousemove', (e: MouseEvent) => {
                if (!artPlayerRef.current) return;

                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const percentage = x / rect.width;
                const duration = artPlayerRef.current.duration || 0;
                hoverTime = percentage * duration;

                // 创建或更新提示框
                if (!tooltipEl) {
                  tooltipEl = document.createElement('div');
                  tooltipEl.style.cssText = `
                  position: absolute;
                  bottom: 100%;
                  transform: translateX(-50%);
                  margin-bottom: 8px;
                  padding: 4px 8px;
                  background: rgba(0, 0, 0, 0.8);
                  color: white;
                  font-size: 12px;
                  border-radius: 4px;
                  white-space: nowrap;
                  pointer-events: none;
                  z-index: 30;
                `;
                  $el.appendChild(tooltipEl);
                }

                tooltipEl.textContent = `${formatTime(
                  hoverTime
                )} - 弹幕密度: ${getDensity(hoverTime)}`;
                tooltipEl.style.left = `${percentage * 100}%`;
                tooltipEl.style.display = 'block';
              });

              // 鼠标离开事件
              canvas.addEventListener('mouseleave', () => {
                if (tooltipEl) {
                  tooltipEl.style.display = 'none';
                }
              });

              // 点击跳转
              canvas.addEventListener('click', (e: MouseEvent) => {
                if (!artPlayerRef.current) return;

                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const percentage = x / rect.width;
                const duration = artPlayerRef.current.duration || 0;
                const time = percentage * duration;

                artPlayerRef.current.currentTime = time;
              });

              // 监听时间更新
              artPlayerRef.current.on('video:timeupdate', drawHeatmap);

              // 监听弹幕数据更新
              const updateHeatmapData = () => {
                if (!artPlayerRef.current) {
                  return;
                }

                if (!danmakuPluginRef.current) {
                  return;
                }

                const duration = artPlayerRef.current.duration || 0;

                // 直接从弹幕插件获取弹幕数据
                const danmakuList =
                  danmakuPluginRef.current.option?.danmuku || [];

                if (danmakuList.length > 0 && duration > 0) {
                  heatmapData = calculateHeatmapData(danmakuList, duration);
                  // 立即绘制热力图
                  drawHeatmap();
                  // 强制再次绘制，确保显示
                  setTimeout(drawHeatmap, 100);
                }
              };

              artPlayerRef.current.on(
                'video:loadedmetadata',
                updateHeatmapData
              );

              // 监听弹幕加载完成事件
              artPlayerRef.current.on('danmaku:loaded', () => {
                updateHeatmapData();
              });

              // 监听弹幕插件的配置变化
              if (danmakuPluginRef.current) {
                const originalConfig = danmakuPluginRef.current.config;
                danmakuPluginRef.current.config = function (...args: any[]) {
                  const result = originalConfig.apply(this, args);
                  setTimeout(updateHeatmapData, 100);
                  return result;
                };
              }

              // 使用轮询机制等待弹幕插件准备好（替代固定延迟）
              let pollAttempts = 0;
              const maxPollAttempts = 120; // 最多尝试 120 次（60 秒）
              const pollInterval = 500; // 每 500ms 检查一次

              const pollForDanmakuPlugin = () => {
                if (
                  danmakuPluginRef.current &&
                  danmakuPluginRef.current.option?.danmuku
                ) {
                  // 弹幕插件已准备好且有数据
                  updateHeatmapData();
                  return; // 成功，停止轮询
                }

                pollAttempts++;
                if (pollAttempts < maxPollAttempts) {
                  // 继续轮询
                  setTimeout(pollForDanmakuPlugin, pollInterval);
                }
              };

              // 开始轮询
              setTimeout(pollForDanmakuPlugin, 500);

              // 清理
              return () => {
                clearInterval(visibilityInterval);
                window.removeEventListener('resize', resizeHandler);
                if (progressResizeObserver) {
                  progressResizeObserver.disconnect();
                }
                if (tooltipEl && tooltipEl.parentNode) {
                  tooltipEl.parentNode.removeChild(tooltipEl);
                }
              };
            },
          });
        }

        // 添加全屏快进快退按钮
        artPlayerRef.current.layers.add({
          name: 'seek-buttons',
          html: `
          <div class="seek-buttons-container" style="display: none;">
            <button class="seek-button seek-backward" style="position: fixed; left: 20px; top: 40%; transform: translateY(-50%); width: 48px; height: 48px; background: rgba(0,0,0,0.7); border: none; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 9999; transition: opacity 0.2s;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" fill="white"/>
              </svg>
            </button>
            <button class="seek-button seek-forward" style="position: fixed; right: 20px; top: 40%; transform: translateY(-50%); width: 48px; height: 48px; background: rgba(0,0,0,0.7); border: none; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 9999; transition: opacity 0.2s;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" fill="white"/>
              </svg>
            </button>
          </div>
        `,
          mounted: ($el: HTMLElement) => {
            const container = $el.querySelector(
              '.seek-buttons-container'
            ) as HTMLElement;
            const backwardBtn = $el.querySelector(
              '.seek-backward'
            ) as HTMLElement;
            const forwardBtn = $el.querySelector(
              '.seek-forward'
            ) as HTMLElement;

            // 快退5秒
            backwardBtn.onclick = () => {
              if (artPlayerRef.current) {
                artPlayerRef.current.currentTime = Math.max(
                  0,
                  artPlayerRef.current.currentTime - 5
                );
              }
            };

            // 快进5秒
            forwardBtn.onclick = () => {
              if (artPlayerRef.current) {
                artPlayerRef.current.currentTime = Math.min(
                  artPlayerRef.current.duration,
                  artPlayerRef.current.currentTime + 5
                );
              }
            };

            // 监听全屏状态变化
            const updateVisibility = () => {
              const isFullscreen =
                artPlayerRef.current?.fullscreen ||
                artPlayerRef.current?.fullscreenWeb ||
                !!document.fullscreenElement;
              const isMobile =
                Math.min(window.innerWidth, window.innerHeight) < 768;
              const controlsVisible =
                !artPlayerRef.current?.template?.$player?.classList.contains(
                  'art-hide-cursor'
                );

              if (container) {
                const shouldShow = isFullscreen && isMobile && controlsVisible;
                container.style.display = shouldShow ? 'block' : 'none';
              }
            };

            artPlayerRef.current.on('fullscreen', updateVisibility);
            artPlayerRef.current.on('fullscreenWeb', updateVisibility);
            document.addEventListener('fullscreenchange', updateVisibility);
            window.addEventListener('resize', updateVisibility);

            // 监听鼠标移动和视频事件来检测控件显示/隐藏
            artPlayerRef.current.on('video:timeupdate', updateVisibility);
            if (artPlayerRef.current.template?.$player) {
              const observer = new MutationObserver(updateVisibility);
              observer.observe(artPlayerRef.current.template.$player, {
                attributes: true,
                attributeFilter: ['class'],
              });
            }

            updateVisibility();
          },
        });

        // 监听视频可播放事件，这时恢复播放进度更可靠
        artPlayerRef.current.on('video:canplay', () => {
          if (!isCurrentMedia(eventPlayer) || !activeMediaRef.current?.started || eventPlayer.video.readyState < 3) return;
          let restoredResumeTime = false;
          if (activeMediaRef.current.resetPosition && !(resumeTimeRef.current && resumeTimeRef.current > 0)) {
            eventPlayer.currentTime = 0;
          }
          activeMediaRef.current.resetPosition = false;

          // 若存在需要恢复的播放进度，则跳转
          if (resumeTimeRef.current && resumeTimeRef.current > 0) {
            try {
              const duration = artPlayerRef.current.duration || 0;
              let target = resumeTimeRef.current;
              if (duration && target >= duration - 2) {
                target = Math.max(0, duration - 5);
              }
              artPlayerRef.current.currentTime = target;
              restoredResumeTime = true;
              console.log('成功恢复播放进度到:', resumeTimeRef.current);
            } catch (err) {
              console.warn('恢复播放进度失败:', err);
            }
          }
          resumeTimeRef.current = null;

          const shouldResumePlaying =
            resumePlayingAfterHlsModeSwitchRef.current;
          resumePlayingAfterHlsModeSwitchRef.current = null;
          if (shouldResumePlaying === false) {
            artPlayerRef.current.pause();
          } else if (shouldResumePlaying === true) {
            Promise.resolve(artPlayerRef.current.play()).catch((error) => {
              console.warn('[Harmony HLS] 恢复播放失败:', error);
            });
          }

          schedulePlayerTimeout(() => {
            if (!artPlayerRef.current) {
              return;
            }

            const restorePlaybackRate = () => {
              if (!artPlayerRef.current) {
                return;
              }

              if (
                Math.abs(
                  artPlayerRef.current.playbackRate -
                    lastPlaybackRateRef.current
                ) > 0.01 &&
                isWebkit
              ) {
                artPlayerRef.current.playbackRate = lastPlaybackRateRef.current;
              }
            };

            if (
              Math.abs(artPlayerRef.current.volume - lastVolumeRef.current) >
              0.01
            ) {
              artPlayerRef.current.volume = lastVolumeRef.current;
            }

            // Safari 在 seek 刚发生时立刻恢复 3x，容易卡进持续 seeking 状态。
            // 这里等 seek 稳定后再恢复倍速，避免恢复进度和变速互相打架。
            if (restoredResumeTime && isWebkit && artPlayerRef.current?.video) {
              const video = artPlayerRef.current.video as HTMLVideoElement;
              const applyRateAfterSeek = () => {
                restorePlaybackRate();
              };

              if (video.seeking) {
                const handleSeeked = () => {
                  clearTrackedTimeout(seekedTimeout);
                  applyRateAfterSeek();
                };
                const seekedTimeout = schedulePlayerTimeout(() => {
                  video.removeEventListener('seeked', handleSeeked);
                  applyRateAfterSeek();
                }, 300);

                video.addEventListener('seeked', handleSeeked, { once: true });
              } else {
                restorePlaybackRate();
              }
            } else {
              restorePlaybackRate();
            }
            syncPlaybackPitch();
            artPlayerRef.current.notice.show = '';
          }, 0);

          // 隐藏换源加载状态
          playbackProgressGuard?.resume(activeMediaRef.current!.revision);
          setIsVideoLoading(false);
          setVideoError(null);
          setCorsFailedUrl(null);
        });

        // 监听视频播放事件，检查是否需要显示播放记录跳转按钮
        artPlayerRef.current.on('video:playing', () => {
          // 检查是否需要显示播放记录跳转按钮
          // 条件：当前播放时间 < 10秒 且 播放记录时间 > 10秒
          const checkPlayRecordJump = async () => {
            try {
              // 短剧不显示"上次播放到"提示（短剧单集太短，提示意义不大）
              if (searchParams.get('duanju') === '1') {
                playRecordJumpInitialCheckRef.current = false;
                return;
              }

              // 仅在进入播放后的首次检查时处理，避免本次会话新生成的记录触发恢复按钮
              if (!playRecordJumpInitialCheckRef.current) {
                return;
              }

              // 如果用户已经关闭过跳转按钮，不再显示
              if (playRecordJumpDismissedRef.current) {
                return;
              }

              const currentTime = artPlayerRef.current?.currentTime || 0;

              // 如果当前播放时间已经大于等于10秒，不显示跳转按钮
              if (currentTime >= 10) {
                // 标记已经进行过首次检查，避免切集后再显示
                playRecordJumpInitialCheckRef.current = false;
                if (playRecordJumpLayerRef.current) {
                  artPlayerRef.current.layers.remove('play-record-jump');
                  playRecordJumpLayerRef.current = null;
                }
                return;
              }

              // 获取播放记录
              const allRecords = await getAllPlayRecords();
              const key = generateStorageKey(
                currentSourceRef.current,
                currentIdRef.current
              );
              const record = allRecords[key];

              if (record) {
                const recordIndex = record.index - 1;
                const recordTime = record.play_time;

                // 检查是否是当前集数且播放记录时间大于10秒且当前时间小于10秒
                if (
                  recordIndex === currentEpisodeIndexRef.current &&
                  recordTime > 10 &&
                  currentTime < 10
                ) {
                  // 如果已经添加过，不重复添加
                  if (playRecordJumpLayerRef.current) {
                    return;
                  }

                  // 标记已经进行过首次检查
                  playRecordJumpInitialCheckRef.current = false;

                  // 格式化时间显示
                  const formatTime = (seconds: number): string => {
                    const h = Math.floor(seconds / 3600);
                    const m = Math.floor((seconds % 3600) / 60);
                    const s = Math.floor(seconds % 60);
                    if (h > 0) {
                      return `${h}:${m.toString().padStart(2, '0')}:${s
                        .toString()
                        .padStart(2, '0')}`;
                    }
                    return `${m}:${s.toString().padStart(2, '0')}`;
                  };

                  // 添加到播放器 layers
                  playRecordJumpLayerRef.current =
                    artPlayerRef.current.layers.add({
                      name: 'play-record-jump',
                      html: `
                      <div id="play-record-jump-container" style="
                        position: absolute;
                        left: 16px;
                        bottom: 60px;
                        z-index: 20;
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        padding: 8px 12px;
                        background-color: rgba(0, 0, 0, 0.75);
                        border-radius: 6px;
                        color: white;
                        font-size: 14px;
                        font-family: system-ui, -apple-system, sans-serif;
                        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
                        backdrop-filter: blur(4px);
                        pointer-events: auto;
                      ">
                        <span style="margin-right: 4px;">
                          上次播放到 ${formatTime(recordTime)}
                        </span>
                        <button id="play-record-jump-btn" style="
                          padding: 4px 12px;
                          background-color: rgba(255, 255, 255, 0.2);
                          border: 1px solid rgba(255, 255, 255, 0.3);
                          border-radius: 4px;
                          color: white;
                          font-size: 13px;
                          cursor: pointer;
                          transition: all 0.2s;
                          font-weight: 500;
                        ">
                          跳转
                        </button>
                        <button id="play-record-dismiss-btn" style="
                          padding: 4px 8px;
                          background-color: transparent;
                          border: none;
                          color: rgba(255, 255, 255, 0.7);
                          font-size: 18px;
                          cursor: pointer;
                          line-height: 1;
                          transition: color 0.2s;
                        " title="关闭">
                          ×
                        </button>
                      </div>
                    `,
                      style: {
                        position: 'absolute',
                        left: 0,
                        bottom: 0,
                        width: '100%',
                        height: '100%',
                        pointerEvents: 'none',
                      },
                    });

                  // 绑定事件
                  const jumpBtn = document.getElementById(
                    'play-record-jump-btn'
                  );
                  const dismissBtn = document.getElementById(
                    'play-record-dismiss-btn'
                  );

                  if (jumpBtn) {
                    jumpBtn.addEventListener('mouseenter', () => {
                      jumpBtn.style.backgroundColor =
                        'rgba(255, 255, 255, 0.3)';
                    });
                    jumpBtn.addEventListener('mouseleave', () => {
                      jumpBtn.style.backgroundColor =
                        'rgba(255, 255, 255, 0.2)';
                    });
                    jumpBtn.addEventListener('click', () => {
                      if (artPlayerRef.current) {
                        artPlayerRef.current.currentTime = recordTime;
                        artPlayerRef.current.notice.show = `已跳转到 ${formatTime(
                          recordTime
                        )}`;
                      }
                      playRecordJumpDismissedRef.current = true;
                      if (playRecordJumpLayerRef.current) {
                        artPlayerRef.current.layers.remove('play-record-jump');
                        playRecordJumpLayerRef.current = null;
                      }
                    });
                  }

                  if (dismissBtn) {
                    dismissBtn.addEventListener('mouseenter', () => {
                      dismissBtn.style.color = 'white';
                    });
                    dismissBtn.addEventListener('mouseleave', () => {
                      dismissBtn.style.color = 'rgba(255, 255, 255, 0.7)';
                    });
                    dismissBtn.addEventListener('click', () => {
                      playRecordJumpDismissedRef.current = true;
                      if (playRecordJumpLayerRef.current) {
                        artPlayerRef.current.layers.remove('play-record-jump');
                        playRecordJumpLayerRef.current = null;
                      }
                    });
                  }

                  console.log(
                    '[PlayRecordJump] 显示跳转按钮，当前时间:',
                    currentTime,
                    '记录时间:',
                    recordTime
                  );
                } else {
                  // 不满足显示条件，也标记为已检查过
                  playRecordJumpInitialCheckRef.current = false;
                }
              } else {
                // 没有播放记录，也标记为已检查过
                playRecordJumpInitialCheckRef.current = false;
              }
            } catch (err) {
              console.error('[PlayRecordJump] 检查播放记录失败:', err);
              // 即使出错也标记为已检查过
              playRecordJumpInitialCheckRef.current = false;
            }
          };

          // 延迟检查，确保播放器已经稳定
          setTimeout(checkPlayRecordJump, 500);
        });

        // 监听视频时间更新事件，实现跳过片头片尾
        artPlayerRef.current.on('video:timeupdate', () => {
          if (!skipConfigRef.current.enable) return;

          const currentTime = artPlayerRef.current.currentTime || 0;
          const duration = artPlayerRef.current.duration || 0;
          const now = Date.now();

          // 限制跳过检查频率为1.5秒一次
          if (now - lastSkipCheckRef.current < 1500) return;
          lastSkipCheckRef.current = now;

          // 跳过片头
          if (
            skipConfigRef.current.intro_time > 0 &&
            currentTime < skipConfigRef.current.intro_time
          ) {
            artPlayerRef.current.currentTime = skipConfigRef.current.intro_time;
            artPlayerRef.current.notice.show = `已跳过片头 (${formatTime(
              skipConfigRef.current.intro_time
            )})`;
          }

          // 跳过片尾
          if (
            skipConfigRef.current.outro_time < 0 &&
            duration > 0 &&
            currentTime >
              artPlayerRef.current.duration + skipConfigRef.current.outro_time
          ) {
            if (
              currentEpisodeIndexRef.current <
              (detailRef.current?.episodes?.length || 1) - 1
            ) {
              handleNextEpisode();
            } else {
              artPlayerRef.current.pause();
            }
            artPlayerRef.current.notice.show = `已跳过片尾 (${formatTime(
              skipConfigRef.current.outro_time
            )})`;
          }
        });

        artPlayerRef.current.on('error', (err: any) => {
          console.error('播放器错误:', err);
          // CORS 回退（单文件直链/网盘挂载原生 HLS）：乐观设置的 crossOrigin 在
          // 无 ACAO 的 CDN 上首次播放即失败，去掉 crossOrigin 以 no-cors 重试一次。
          // 必须放在 currentTime 守卫与 HLS 分流之前，覆盖原生 HLS 的 m3u8 失败。
          {
            const fallbackVideo = artPlayerRef.current?.video as
              | HTMLVideoElement
              | undefined;
            if (
              fallbackVideo &&
              (artPlayerRef.current?.currentTime || 0) === 0 &&
              fallbackVideo.crossOrigin === 'anonymous' &&
              !mediaCorsFallbackRef.current &&
              (videoMediaTypeRef.current === 'file' ||
                isNetdiskNativeHlsActive(currentSourceRef.current))
            ) {
              mediaCorsFallbackRef.current = true;
              console.warn(
                '[play] CORS 模式播放失败，回退 no-cors（无扩展/无 ACAO 的 CDN）'
              );
              try {
                fallbackVideo.crossOrigin = null;
              } catch {
                // ignore
              }
              const fallbackUrl = artPlayerRef.current?.option?.url || videoUrl;
              ensureVideoSource(fallbackVideo, fallbackUrl);
              fallbackVideo.load();
              try {
                const playPromise = fallbackVideo.play();
                if (playPromise && typeof playPromise.catch === 'function') {
                  playPromise.catch(() => {
                    /* Autoplay may require a user gesture; the player controls remain available. */
                  });
                }
              } catch {
                // ignore
              }
              return;
            }
          }
          // 如果已经成功播放过一段时间，忽略后续错误（可能是短暂网络波动）
          if (artPlayerRef.current && artPlayerRef.current.currentTime > 0) {
            return;
          }
          // 原生 <video> 播放失败（非 HLS.js 管理的场景，如无后缀的直链）
          // 需要触发播放失败 UI，否则会永远卡在"加载中"
          const currentUrl = artPlayerRef.current?.option?.url || videoUrl;
          const isUsingHls =
            currentUrl.includes('/api/proxy-m3u8') ||
            currentUrl.includes('/api/proxy/vod/m3u8') ||
            currentUrl.toLowerCase().includes('.m3u8') ||
            currentUrl.toLowerCase().includes('.m3u');
          if (!isUsingHls) {
            // 非 HLS 场景下的原生视频错误，显示错误 UI
            if (proxyAttemptedRef.current) {
              // 代理已经尝试过（走了 415→直连 的路径），直连也失败了，不再提供代理按钮
              setVideoError('视频无法在浏览器中播放（已尝试代理，格式不兼容）');
            } else if (
              currentSourceRef.current === 'directplay' &&
              !currentUrl.includes('/api/proxy-m3u8')
            ) {
              setCorsFailedUrl(currentUrl);
              setVideoError('视频播放失败');
            } else {
              setVideoError('视频播放失败');
            }
          }
        });

        // Auto-next uses the same selection/URL path as a manual episode switch.
        artPlayerRef.current.on('video:ended', () => {
          if (!isCurrentMedia(eventPlayer)) return;
          if (playSync.shouldDisableControls) {
            eventPlayer.notice.show = '等待房主切换下一集';
            return;
          }
          const completedMedia = activeMediaRef.current;
          schedulePlayerTimeout(() => {
            if (completedMedia !== activeMediaRef.current || !isCurrentMedia(eventPlayer)) return;
            void handleNextEpisode(true);
          }, 1000);
        });

        artPlayerRef.current.on('video:timeupdate', () => {
          const now = Date.now();
          let interval = 5000;
          if (process.env.NEXT_PUBLIC_STORAGE_TYPE === 'upstash') {
            interval = 20000;
          }
          if (now - lastSaveTimeRef.current > interval) {
            saveCurrentPlayProgress();
            lastSaveTimeRef.current = now;
          }

          // 下集预缓冲逻辑
          const nextEpisodePreCacheEnabled =
            typeof window !== 'undefined'
              ? localStorage.getItem('nextEpisodePreCache') === 'true'
              : false;

          if (nextEpisodePreCacheEnabled) {
            const currentTime = artPlayerRef.current?.currentTime || 0;
            const duration = artPlayerRef.current?.duration || 0;
            const progress = duration > 0 ? currentTime / duration : 0;

            // 检查是否已经到达90%播放进度
            if (
              duration > 0 &&
              progress >= 0.9 &&
              !nextEpisodePreCacheTriggeredRef.current
            ) {
              // 标记已触发，防止重复执行
              nextEpisodePreCacheTriggeredRef.current = true;

              // 获取下一集信息
              const currentIdx = currentEpisodeIndexRef.current;
              const episodes = detailRef.current?.episodes;

              if (!episodes || currentIdx >= episodes.length - 1) {
                return;
              }

              const nextEpisodeIndex = currentIdx + 1;
              const nextEpisodeUrl = episodes[nextEpisodeIndex];

              if (!nextEpisodeUrl) {
                return;
              }

              // 使用 fetch 预加载资源，利用浏览器缓存
              const preloadNextEpisode = async () => {
                try {
                  // 判断是否是m3u8流
                  if (
                    nextEpisodeUrl.includes('.m3u8') ||
                    nextEpisodeUrl.includes('m3u8')
                  ) {
                    // 1. 先fetch m3u8文件
                    const m3u8Response = await fetch(nextEpisodeUrl);
                    const m3u8Text = await m3u8Response.text();

                    // 2. 解析m3u8，提取ts分片URL
                    const lines = m3u8Text.split('\n');
                    const tsUrls: string[] = [];
                    const baseUrl = nextEpisodeUrl.substring(
                      0,
                      nextEpisodeUrl.lastIndexOf('/') + 1
                    );

                    for (const line of lines) {
                      const trimmedLine = line.trim();
                      // 跳过注释和空行
                      if (!trimmedLine || trimmedLine.startsWith('#')) {
                        continue;
                      }
                      // 构建完整的ts URL
                      const tsUrl = trimmedLine.startsWith('http')
                        ? trimmedLine
                        : baseUrl + trimmedLine;
                      tsUrls.push(tsUrl);
                    }

                    // 3. 预加载前20个ts分片
                    const maxFragmentsToPreload = Math.min(20, tsUrls.length);

                    for (let i = 0; i < maxFragmentsToPreload; i++) {
                      try {
                        await fetch(tsUrls[i]);
                      } catch {
                        // 静默处理分片加载失败
                      }
                    }
                  }
                } catch {
                  // 静默处理预缓冲失败
                }
              };

              // 异步执行预缓冲
              preloadNextEpisode();
            }
          }

          // 下集弹幕预加载逻辑
          const nextEpisodeDanmakuPreloadEnabled =
            typeof window !== 'undefined'
              ? localStorage.getItem('nextEpisodeDanmakuPreload') === 'true'
              : false;

          if (nextEpisodeDanmakuPreloadEnabled) {
            const currentTime = artPlayerRef.current?.currentTime || 0;
            const duration = artPlayerRef.current?.duration || 0;
            const progress = duration > 0 ? currentTime / duration : 0;

            // 检查是否已经到达90%播放进度
            if (
              duration > 0 &&
              progress >= 0.9 &&
              !nextEpisodeDanmakuPreloadTriggeredRef.current
            ) {
              // 标记已触发，防止重复执行
              nextEpisodeDanmakuPreloadTriggeredRef.current = true;

              // 异步执行弹幕预加载
              preloadNextEpisodeDanmaku();
            }
          }
        });

        activeHarmonyHlsPlaybackModeRef.current = isHarmonyOS
          ? harmonyHlsPlaybackMode
          : 'hlsjs';
        activeNativeHlsAdBlockRef.current = nativeHlsAdBlockEnabled;
        activeNetdiskHlsPlaybackModeRef.current = isNetdiskMountSource(
          currentSourceRef.current
        )
          ? netdiskHlsPlaybackMode
          : null;

        if (artPlayerRef.current?.video) {
          const exposedVideoUrl = isNetdiskNativeHlsActive(
            currentSourceRef.current
          )
            ? videoUrl
            : isHarmonyOS && harmonyHlsPlaybackMode === 'native'
            ? buildNativeHlsPlaybackUrl(videoUrl)
            : videoUrl;
          ensureVideoSource(
            artPlayerRef.current.video as HTMLVideoElement,
            exposedVideoUrl
          );
        }
      } catch (err) {
        if (!isCurrentInitialization()) return;
        console.error('创建播放器失败:', err);
        setError('播放器初始化失败');
      }
    };

    // 调用异步初始化函数
    initPlayer();
    return () => {
      initializationRef.current++;
    };
  }, [
    videoUrl,
    videoProgressRevision,
    playbackProgressGuard,
    loading,
    blockAdEnabled,
    harmonyHlsPlaybackMode,
    nativeHlsAdBlockEnabled,
    netdiskHlsPlaybackMode,
  ]);
}
