/* eslint-disable no-console */

'use client';

import {
  BookMarked,
  BookOpen,
  Bot,
  Link as LinkIcon,
  ListVideo,
  Music,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Suspense,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';

import type { InitialBannerArtwork } from '@/lib/home/banner-artwork';
import type { BannerData } from '@/lib/home/banner-types';
import { getRuntimeConfig } from '@/lib/runtime-config';
import { getTMDBImageUrl } from '@/lib/tmdb.client';
import { base58Encode, processImageUrl } from '@/lib/utils';

import BannerCarousel from '@/components/BannerCarousel';
import ContinueWatching from '@/components/ContinueWatching';
import FireworksCanvas from '@/components/FireworksCanvas';
import CinemaShelf from '@/components/home/CinemaShelf';
import {
  HomeModule,
  useHomeRecommendations,
} from '@/components/home/useHomeRecommendations';
import HttpWarningDialog from '@/components/HttpWarningDialog';
import PageLayout from '@/components/PageLayout';
import { useSite } from '@/components/SiteProvider';
import Toast, { ToastProps } from '@/components/Toast';
import VideoCard from '@/components/VideoCard';

const AIChatPanel = dynamic(() => import('@/components/AIChatPanel'), {
  ssr: false,
});

const subscribeToRuntimeConfig = () => () => undefined;

interface HomePageProps {
  initialBannerArtwork?: InitialBannerArtwork;
  initialBannerData?: BannerData | null;
  initialBannerEnabled?: boolean;
}

function HomeClient({
  initialBannerData,
  initialBannerArtwork,
  initialBannerEnabled = true,
}: HomePageProps) {
  const router = useRouter();
  const [layoutReady, setLayoutReady] = useState(false);
  const { announcement, announcementDisplayMode } = useSite();
  // 首页模块配置状态
  const [homeModules, setHomeModules] = useState<HomeModule[]>([
    { id: 'hotMovies', name: '热门电影', enabled: true, order: 0 },
    { id: 'hotDuanju', name: '热播短剧', enabled: true, order: 1 },
    { id: 'bangumiCalendar', name: '新番放送', enabled: true, order: 2 },
    { id: 'hotTvShows', name: '热门剧集', enabled: true, order: 3 },
    { id: 'hotVarietyShows', name: '热门综艺', enabled: true, order: 4 },
    { id: 'upcomingContent', name: '即将上映', enabled: true, order: 5 },
  ]);
  const recommendations = useHomeRecommendations(homeModules, layoutReady);
  const hotMovies = recommendations.hotMovies.data;
  const hotTvShows = recommendations.hotTvShows.data;
  const hotVarietyShows = recommendations.hotVarietyShows.data;
  const hotDuanju = recommendations.hotDuanju.data;
  const bangumiCalendarData = recommendations.bangumiCalendar.data;
  const upcomingContent = recommendations.upcomingContent.data;
  const [homeBannerEnabled, setHomeBannerEnabled] =
    useState(initialBannerEnabled);
  const [homeContinueWatchingEnabled, setHomeContinueWatchingEnabled] =
    useState(true);

  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const [showHttpWarning, setShowHttpWarning] = useState(true);
  const [showAIChat, setShowAIChat] = useState(false);
  const [aiChatLoaded, setAIChatLoaded] = useState(false);
  const aiEnabled = useSyncExternalStore(
    subscribeToRuntimeConfig,
    () =>
      Boolean(
        getRuntimeConfig().AI_ENABLED &&
          getRuntimeConfig().AI_ENABLE_HOMEPAGE_ENTRY
      ),
    () => false
  );
  const aiDefaultMessageNoVideo = useSyncExternalStore(
    subscribeToRuntimeConfig,
    () => {
      const value = getRuntimeConfig().AI_DEFAULT_MESSAGE_NO_VIDEO;
      return typeof value === 'string'
        ? value
        : '你好！我是PureTV的AI影视助手。想看什么电影或剧集？需要推荐吗？';
    },
    () => '你好！我是PureTV的AI影视助手。想看什么电影或剧集？需要推荐吗？'
  );
  const sourceSearchEnabled = useSyncExternalStore(
    subscribeToRuntimeConfig,
    () => getRuntimeConfig().ENABLE_SOURCE_SEARCH !== false,
    () => true
  );
  const musicEnabled = useSyncExternalStore(
    subscribeToRuntimeConfig,
    () => Boolean(getRuntimeConfig().MUSIC_ENABLED),
    () => false
  );
  const mangaEnabled = useSyncExternalStore(
    subscribeToRuntimeConfig,
    () => Boolean(getRuntimeConfig().SUWAYOMI_ENABLED),
    () => false
  );
  const booksEnabled = useSyncExternalStore(
    subscribeToRuntimeConfig,
    () => Boolean(getRuntimeConfig().BOOKS_ENABLED),
    () => false
  );
  const netdiskTempPlayEnabled = useSyncExternalStore(
    subscribeToRuntimeConfig,
    () => Boolean(getRuntimeConfig().NETDISK_TEMP_PLAY_ENABLED),
    () => false
  );
  const [showDirectPlayDialog, setShowDirectPlayDialog] = useState(false);
  const [directPlayUrl, setDirectPlayUrl] = useState('');
  const [directPlaySubmitting, setDirectPlaySubmitting] = useState(false);
  const [toast, setToast] = useState<ToastProps | null>(null);

  const detectNetdiskLink = (
    url: string
  ): {
    provider: 'quark' | 'mobile' | 'baidu' | 'tianyi' | '123' | 'uc' | '115';
    shareUrl: string;
    passcode?: string;
  } | null => {
    const trimmed = url.trim();

    const pickPasscode = (...values: Array<string | undefined>) =>
      values.map((item) => item?.trim()).find(Boolean);

    const inlinePasscode = (text: string) =>
      pickPasscode(
        text.match(
          /(?:提取码|访问码|密码)\s*[:：=]?\s*([a-zA-Z0-9]{4,8})/i
        )?.[1],
        text.match(/[?&](?:pwd|passcode|accessCode)=([^&\s]+)/i)?.[1]
      );

    if (
      /https:\/\/(?:www\.)?123(?:684|865|912|pan)\.(?:com|cn)\/s\//i.test(
        trimmed
      )
    ) {
      return {
        provider: '123',
        shareUrl: trimmed,
        passcode: pickPasscode(
          trimmed.match(/[?&]pwd=([^&]+)/i)?.[1],
          inlinePasscode(trimmed)
        ),
      };
    }

    if (
      /https:\/\/cloud\.189\.cn\/(web\/share\?code=|t\/)/i.test(trimmed) ||
      /https:\/\/h5\.cloud\.189\.cn\/share\.html#\/t\//i.test(trimmed)
    ) {
      return {
        provider: 'tianyi',
        shareUrl: trimmed,
        passcode: pickPasscode(
          trimmed.match(/[?&]pwd=([^&]+)/i)?.[1],
          inlinePasscode(trimmed)
        ),
      };
    }

    if (/pan\.baidu\.com\/(s\/|wap\/init\?surl=)/i.test(trimmed)) {
      return {
        provider: 'baidu',
        shareUrl: trimmed,
        passcode: pickPasscode(
          trimmed.match(/[?&](?:pwd|accessCode)=([^&]+)/i)?.[1],
          inlinePasscode(trimmed)
        ),
      };
    }

    if (/https:\/\/pan\.quark\.cn\/s\//i.test(trimmed)) {
      return {
        provider: 'quark',
        shareUrl: trimmed,
        passcode: pickPasscode(
          trimmed.match(/[?&](?:pwd|passcode)=([^&]+)/i)?.[1],
          inlinePasscode(trimmed)
        ),
      };
    }

    if (/https:\/\/drive\.uc\.cn\/s\//i.test(trimmed)) {
      return {
        provider: 'uc',
        shareUrl: trimmed,
        passcode: pickPasscode(
          trimmed.match(/[?&](?:pwd|passcode)=([^&]+)/i)?.[1],
          inlinePasscode(trimmed)
        ),
      };
    }

    if (/https:\/\/(?:yun|caiyun)\.139\.com\//i.test(trimmed)) {
      return { provider: 'mobile', shareUrl: trimmed };
    }

    if (/https:\/\/(?:115|anxia|115cdn)\.com\/s\//i.test(trimmed)) {
      return {
        provider: '115',
        shareUrl: trimmed,
        passcode: pickPasscode(
          trimmed.match(/[?&](?:password|pwd|passcode)=([^&]+)/i)?.[1],
          inlinePasscode(trimmed)
        ),
      };
    }

    return null;
  };

  const handleDirectPlay = () => {
    setDirectPlayUrl('');
    setShowDirectPlayDialog(true);
  };

  const submitDirectPlay = async () => {
    const trimmed = directPlayUrl.trim();
    if (!trimmed) return;
    setDirectPlaySubmitting(true);
    try {
      const netdisk = detectNetdiskLink(trimmed);
      if (netdisk && !netdiskTempPlayEnabled) {
        throw new Error('无权限使用临时播放');
      }

      if (netdisk) {
        const source =
          netdisk.provider === 'mobile'
            ? 'netdisk-mobile'
            : netdisk.provider === 'baidu'
            ? 'netdisk-baidu'
            : netdisk.provider === 'tianyi'
            ? 'netdisk-tianyi'
            : netdisk.provider === '115'
            ? 'netdisk-115'
            : netdisk.provider === 'uc'
            ? 'netdisk-uc'
            : netdisk.provider === '123'
            ? 'netdisk-123'
            : 'netdisk-quark';
        const id = base58Encode(
          JSON.stringify({
            shareUrl: netdisk.shareUrl,
            passcode: netdisk.passcode || '',
          })
        );
        if (!id) {
          throw new Error('网盘链接编码失败');
        }
        const targetUrl = `/play?source=${encodeURIComponent(
          source
        )}&id=${encodeURIComponent(id)}&title=${encodeURIComponent(
          '网盘直链播放'
        )}`;
        setShowDirectPlayDialog(false);
        setDirectPlayUrl('');
        router.push(targetUrl);
        return;
      }

      const encoded = base58Encode(trimmed);
      if (!encoded) return;
      const targetUrl = `/play?source=directplay&id=${encodeURIComponent(
        encoded
      )}`;
      setShowDirectPlayDialog(false);
      setDirectPlayUrl('');
      router.push(targetUrl);
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : '播放失败',
        type: 'error',
        onClose: () => setToast(null),
      });
    } finally {
      setDirectPlaySubmitting(false);
    }
  };

  const loadHomeLayoutSettings = () => {
    if (typeof window === 'undefined') return;
    const readSetting = (key: string) => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    };

    const savedHomeModules = readSetting('homeModules');
    if (savedHomeModules) {
      try {
        const parsed: unknown = JSON.parse(savedHomeModules);
        if (
          Array.isArray(parsed) &&
          parsed.every(
            (module) =>
              module &&
              typeof module.id === 'string' &&
              typeof module.enabled === 'boolean' &&
              Number.isFinite(module.order)
          )
        ) {
          setHomeModules(parsed);
        }
      } catch (error) {
        console.error('解析首页模块配置失败:', error);
      }
    }

    const savedHomeBannerEnabled = readSetting('homeBannerEnabled');
    if (savedHomeBannerEnabled !== null) {
      setHomeBannerEnabled(savedHomeBannerEnabled === 'true');
      document.cookie =
        'puretv_home_banner=' +
        (savedHomeBannerEnabled === 'true' ? 'true' : 'false') +
        '; Path=/; Max-Age=31536000; SameSite=Lax';
    }

    const savedHomeContinueWatchingEnabled = readSetting(
      'homeContinueWatchingEnabled'
    );
    if (savedHomeContinueWatchingEnabled !== null) {
      setHomeContinueWatchingEnabled(
        savedHomeContinueWatchingEnabled === 'true'
      );
    }
  };

  // 加载首页模块配置
  useEffect(() => {
    loadHomeLayoutSettings();
    setLayoutReady(true);
  }, []);

  // 监听首页模块配置更新事件
  useEffect(() => {
    const handleHomeModulesUpdated = () => {
      loadHomeLayoutSettings();
    };

    window.addEventListener('homeModulesUpdated', handleHomeModulesUpdated);
    return () => {
      window.removeEventListener(
        'homeModulesUpdated',
        handleHomeModulesUpdated
      );
    };
  }, []);

  // 检查公告弹窗状态
  useEffect(() => {
    if (typeof window !== 'undefined' && announcement) {
      // 会话级标记：只在首次访问站点时弹出，导航切回首页不重复弹
      if (sessionStorage.getItem('announcementShown')) {
        return;
      }
      // 每次显示模式：每次新会话首次访问弹出一次
      if (announcementDisplayMode === 'every') {
        setShowAnnouncement(true);
        sessionStorage.setItem('announcementShown', '1');
        return;
      }
      // 单次显示模式：localStorage 记住已看过的公告文本，换公告则重新弹出
      const hasSeenAnnouncement = localStorage.getItem('hasSeenAnnouncement');
      if (hasSeenAnnouncement !== announcement) {
        setShowAnnouncement(true);
      } else {
        setShowAnnouncement(Boolean(!hasSeenAnnouncement && announcement));
      }
    }
  }, [announcement, announcementDisplayMode]);

  const handleCloseAnnouncement = (announcement: string) => {
    setShowAnnouncement(false);
    localStorage.setItem('hasSeenAnnouncement', announcement); // 记录已查看弹窗
  };

  // 渲染模块的函数
  const renderModule = (moduleId: string) => {
    const loading =
      recommendations[moduleId as keyof typeof recommendations]?.loading;
    switch (moduleId) {
      case 'hotMovies':
        return (
          <CinemaShelf
            key='hotMovies'
            title='热门电影'
            variant='ranked'
            subtitle='值得一看，值得回味'
            href='/douban?type=movie'
          >
            {loading
              ? Array.from({ length: 8 }).map((_, index) => (
                  <div key={index} className='cinema-poster'>
                    <div className='aspect-2/3 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse mb-2' />
                    <div className='h-4 bg-gray-200 dark:bg-gray-700 rounded-sm animate-pulse w-3/4' />
                  </div>
                ))
              : hotMovies.slice(0, 10).map((movie, index) => (
                  <div
                    key={movie.id}
                    className='cinema-poster cinema-ranked-card'
                  >
                    <span className='cinema-rank' aria-hidden='true'>
                      {index + 1}
                    </span>
                    <VideoCard
                      id={movie.id}
                      poster={movie.poster}
                      title={movie.title}
                      year={movie.year}
                      rate={movie.rate}
                      type='movie'
                      from='douban'
                      douban_id={movie.id ? parseInt(movie.id) : undefined}
                    />
                  </div>
                ))}
          </CinemaShelf>
        );

      case 'hotDuanju':
        if (!loading && hotDuanju.length === 0) return null;
        return (
          <CinemaShelf
            key='hotDuanju'
            title='热播短剧'
            subtitle='短一点，也精彩'
            href='/duanju'
          >
            {loading
              ? Array.from({ length: 8 }).map((_, index) => (
                  <div key={index} className='cinema-poster'>
                    <div className='aspect-2/3 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse mb-2' />
                    <div className='h-4 bg-gray-200 dark:bg-gray-700 rounded-sm animate-pulse w-3/4' />
                  </div>
                ))
              : hotDuanju.map((duanju) => (
                  <div
                    key={duanju.id + duanju.source}
                    className='cinema-poster'
                  >
                    <VideoCard
                      id={duanju.id}
                      source={duanju.source}
                      poster={duanju.poster}
                      title={duanju.title}
                      year={duanju.year}
                      type='tv'
                      from='search'
                      source_name={duanju.source_name}
                      episodes={duanju.episodes?.length}
                      douban_id={duanju.douban_id}
                      cmsData={{
                        desc: duanju.desc,
                        episodes: duanju.episodes,
                        episodes_titles: duanju.episodes_titles,
                      }}
                    />
                  </div>
                ))}
          </CinemaShelf>
        );

      case 'bangumiCalendar':
        return (
          <CinemaShelf
            key='bangumiCalendar'
            title='新番放送'
            subtitle='进入另一个世界'
            href='/douban?type=anime'
          >
            {loading
              ? Array.from({ length: 8 }).map((_, index) => (
                  <div key={index} className='cinema-poster'>
                    <div className='relative aspect-2/3 w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'>
                      <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700'></div>
                    </div>
                    <div className='mt-2 h-4 bg-gray-200 rounded-sm animate-pulse dark:bg-gray-800'></div>
                  </div>
                ))
              : (() => {
                  const today = new Date();
                  const weekdays = [
                    'Sun',
                    'Mon',
                    'Tue',
                    'Wed',
                    'Thu',
                    'Fri',
                    'Sat',
                  ];
                  const currentWeekday = weekdays[today.getDay()];
                  const todayAnimes =
                    bangumiCalendarData
                      .find((item) => item.weekday.en === currentWeekday)
                      ?.items.filter((anime) => anime.images) || [];

                  return todayAnimes.map((anime, index) => (
                    <div key={`${anime.id}-${index}`} className='cinema-poster'>
                      <VideoCard
                        from='douban'
                        title={anime.name_cn || anime.name}
                        poster={
                          anime.images?.large ||
                          anime.images?.common ||
                          anime.images?.medium ||
                          anime.images?.small ||
                          anime.images?.grid ||
                          ''
                        }
                        douban_id={anime.id}
                        rate={anime.rating?.score?.toFixed(1) || ''}
                        year={anime.air_date?.split('-')?.[0] || ''}
                        isBangumi={true}
                      />
                    </div>
                  ));
                })()}
          </CinemaShelf>
        );

      case 'hotTvShows':
        return (
          <CinemaShelf
            key='hotTvShows'
            title='热门剧集'
            variant='landscape'
            subtitle='好故事，未完待续'
            href='/douban?type=tv'
          >
            {loading
              ? Array.from({ length: 8 }).map((_, index) => (
                  <div key={index} className='cinema-poster'>
                    <div className='aspect-2/3 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse mb-2' />
                    <div className='h-4 bg-gray-200 dark:bg-gray-700 rounded-sm animate-pulse w-3/4' />
                  </div>
                ))
              : hotTvShows.map((tvShow) => (
                  <div key={tvShow.id} className='cinema-poster'>
                    <VideoCard
                      id={tvShow.id}
                      orientation='horizontal'
                      poster={tvShow.poster}
                      title={tvShow.title}
                      year={tvShow.year}
                      rate={tvShow.rate}
                      type='tv'
                      from='douban'
                      douban_id={tvShow.id ? parseInt(tvShow.id) : undefined}
                    />
                  </div>
                ))}
          </CinemaShelf>
        );

      case 'hotVarietyShows':
        return (
          <CinemaShelf
            key='hotVarietyShows'
            title='热门综艺'
            subtitle='给生活一点轻松'
            href='/douban?type=show'
          >
            {loading
              ? Array.from({ length: 8 }).map((_, index) => (
                  <div key={index} className='cinema-poster'>
                    <div className='aspect-2/3 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse mb-2' />
                    <div className='h-4 bg-gray-200 dark:bg-gray-700 rounded-sm animate-pulse w-3/4' />
                  </div>
                ))
              : hotVarietyShows.map((varietyShow) => (
                  <div key={varietyShow.id} className='cinema-poster'>
                    <VideoCard
                      id={varietyShow.id}
                      poster={varietyShow.poster}
                      title={varietyShow.title}
                      year={varietyShow.year}
                      rate={varietyShow.rate}
                      type='tv'
                      from='douban'
                      douban_id={
                        varietyShow.id ? parseInt(varietyShow.id) : undefined
                      }
                    />
                  </div>
                ))}
          </CinemaShelf>
        );

      case 'upcomingContent':
        if (!loading && upcomingContent.length === 0) return null;
        return (
          <CinemaShelf
            key='upcomingContent'
            title='即将上映'
            subtitle='下一份期待'
          >
            {loading
              ? Array.from({ length: 8 }).map((_, index) => (
                  <div key={index} className='cinema-poster'>
                    <div className='aspect-2/3 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse mb-2' />
                    <div className='h-4 bg-gray-200 dark:bg-gray-700 rounded-sm animate-pulse w-3/4' />
                  </div>
                ))
              : upcomingContent.map((item) => (
                  <div
                    key={`${item.media_type}-${item.id}`}
                    className='cinema-poster'
                  >
                    <VideoCard
                      title={item.title}
                      poster={processImageUrl(
                        getTMDBImageUrl(item.poster_path)
                      )}
                      year={item.release_date?.split('-')?.[0] || ''}
                      rate={
                        item.vote_average && item.vote_average > 0
                          ? item.vote_average.toFixed(1)
                          : ''
                      }
                      type={item.media_type === 'tv' ? 'tv' : 'movie'}
                      from='douban'
                      tmdb_id={item.id}
                      releaseDate={item.release_date}
                      isUpcoming={true}
                    />
                  </div>
                ))}
          </CinemaShelf>
        );

      default:
        return null;
    }
  };

  return (
    <PageLayout cinematic>
      <FireworksCanvas />
      {/* TMDB 热门轮播图 */}
      {homeBannerEnabled && (
        <div className='cinema-hero-wrap'>
          <BannerCarousel
            autoPlayInterval={9000}
            initialData={initialBannerData}
            initialArtwork={initialBannerArtwork}
          />
        </div>
      )}

      {!homeBannerEnabled && (
        <div className='cinema-intro'>
          <p>你的私人影院</p>
          <h1>发现下一部好故事。</h1>
        </div>
      )}
      <div className='cinema-content'>
        <div>
          {/* 首页内容 */}
          <>
            {/* 继续观看 */}
            {homeContinueWatchingEnabled && (
              <ContinueWatching className='cinema-continue' />
            )}

            {/* 根据配置动态渲染首页模块 */}
            {homeModules
              .filter((module) => module.enabled)
              .sort((a, b) => a.order - b.order)
              .map((module) => renderModule(module.id))}

            <div className='cinema-utilities' aria-label='更多观影方式'>
              <span className='cinema-utilities-label'>更多发现</span>
              <div className='cinema-utility-links'>
                <button onClick={handleDirectPlay}>
                  <LinkIcon size={16} />
                  直链播放
                </button>
                {sourceSearchEnabled && (
                  <Link href='/source-search'>
                    <ListVideo size={16} />
                    源站寻片
                  </Link>
                )}
                {aiEnabled && (
                  <button
                    onClick={() => {
                      setAIChatLoaded(true);
                      setShowAIChat(true);
                    }}
                  >
                    <Bot size={16} />
                    AI 问片
                  </button>
                )}
                {musicEnabled && (
                  <Link href='/music' prefetch={false}>
                    <Music size={16} />
                    音乐
                  </Link>
                )}
                {mangaEnabled && (
                  <Link href='/manga' prefetch={false}>
                    <BookOpen size={16} />
                    漫画
                  </Link>
                )}
                {booksEnabled && (
                  <Link href='/books' prefetch={false}>
                    <BookMarked size={16} />
                    电子书
                  </Link>
                )}
              </div>
            </div>
          </>
        </div>
      </div>

      {/* HTTP 环境警告弹窗 */}
      {showHttpWarning && (
        <HttpWarningDialog onClose={() => setShowHttpWarning(false)} />
      )}

      {/* AI问片面板 */}
      {aiEnabled && aiChatLoaded && (
        <AIChatPanel
          isOpen={showAIChat}
          onClose={() => setShowAIChat(false)}
          welcomeMessage={aiDefaultMessageNoVideo}
        />
      )}

      {/* 公告弹窗 */}
      {showAnnouncement && (
        <div className='fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4'>
          <div className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6'>
            <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3'>
              公告
            </h3>
            <div className='text-gray-700 dark:text-gray-300 mb-4 whitespace-pre-wrap'>
              {announcement}
            </div>
            <button
              onClick={() => handleCloseAnnouncement(announcement || '')}
              className='w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors'
            >
              知道了
            </button>
          </div>
        </div>
      )}

      {showDirectPlayDialog && (
        <div
          className='fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4'
          onClick={() => setShowDirectPlayDialog(false)}
        >
          <div
            className='bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-lg'
            onClick={(event) => event.stopPropagation()}
          >
            <div className='flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700'>
              <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                直链播放
              </h3>
              <button
                onClick={() => setShowDirectPlayDialog(false)}
                className='p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors'
                aria-label='关闭'
              >
                <span className='text-gray-600 dark:text-gray-400'>×</span>
              </button>
            </div>
            <div className='p-4 space-y-4'>
              <div className='text-sm text-gray-600 dark:text-gray-300'>
                请输入可直接播放的视频链接。
              </div>
              {netdiskTempPlayEnabled && (
                <div className='text-xs text-gray-500 dark:text-gray-400'>
                  支持夸克、UC、百度、天翼、移动、123、115 网盘在线播放。
                </div>
              )}
              <input
                value={directPlayUrl}
                onChange={(event) => setDirectPlayUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    submitDirectPlay();
                  }
                }}
                placeholder='https://example.com/video.m3u8'
                className='w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-hidden focus:ring-2 focus:ring-blue-500'
              />
              <div className='flex justify-end gap-2'>
                <button
                  onClick={() => setShowDirectPlayDialog(false)}
                  className='px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
                >
                  取消
                </button>
                <button
                  onClick={submitDirectPlay}
                  disabled={!directPlayUrl.trim() || directPlaySubmitting}
                  className='px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                >
                  {directPlaySubmitting ? '处理中...' : '开始播放'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast {...toast} />}
    </PageLayout>
  );
}

export default function HomePageClient(props: HomePageProps) {
  return (
    <Suspense>
      <HomeClient {...props} />
    </Suspense>
  );
}
