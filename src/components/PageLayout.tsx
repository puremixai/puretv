'use client';

import { usePathname } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { BackButton } from './BackButton';
import CinemaHeader from './home/CinemaHeader';
import MobileBottomNav from './MobileBottomNav';
import MobileHeader from './MobileHeader';
import Sidebar from './Sidebar';
import { UpdateNotification } from './UpdateNotification';
import { VersionCheckProvider } from './VersionCheckProvider';

interface PageLayoutProps {
  children: React.ReactNode;
  activePath?: string;
  hideNavigation?: boolean; // 控制是否隐藏顶部和底部导航栏
  cinematic?: boolean;
}

const PageLayout = ({
  children,
  activePath = '/',
  hideNavigation = false,
  cinematic,
}: PageLayoutProps) => {
  const pathname = usePathname();
  const isCinema =
    cinematic ?? !(pathname === '/admin' || pathname.startsWith('/admin/'));
  const isHome = pathname === '/';
  const [backgroundImage, setBackgroundImage] = useState('');
  const shouldShowSharedBackground =
    !isCinema && !hideNavigation && activePath !== '/play';

  useEffect(() => {
    if (typeof window === 'undefined' || !shouldShowSharedBackground) {
      setBackgroundImage('');
      return;
    }

    const homeBg = (
      window as Window & {
        RUNTIME_CONFIG?: {
          HOME_BACKGROUND_IMAGE?: string;
        };
      }
    ).RUNTIME_CONFIG?.HOME_BACKGROUND_IMAGE;
    if (!homeBg) {
      setBackgroundImage('');
      return;
    }

    const urls = homeBg
      .split('\n')
      .map((url: string) => url.trim())
      .filter((url: string) => url !== '');

    if (urls.length === 0) {
      setBackgroundImage('');
      return;
    }

    const randomIndex = Math.floor(Math.random() * urls.length);
    setBackgroundImage(urls[randomIndex]);
  }, [shouldShowSharedBackground]);

  return (
    <VersionCheckProvider>
      <div
        className={`relative w-full min-h-screen overflow-hidden ${
          isCinema ? 'cinema-layout' : ''
        }`}
        data-cinema-view={isHome ? 'home' : 'content'}
        data-navigation-hidden={hideNavigation}
      >
        {shouldShowSharedBackground && backgroundImage && (
          <>
            <div
              className='absolute inset-0 pointer-events-none bg-cover bg-center bg-no-repeat opacity-45'
              style={{ backgroundImage: `url(${backgroundImage})` }}
            />
            <div className='absolute inset-0 pointer-events-none bg-white/50 dark:bg-gray-950/50' />
          </>
        )}

        {/* 移动端头部 */}
        {!hideNavigation && isCinema && (
          <Suspense>
            <CinemaHeader />
          </Suspense>
        )}
        {!hideNavigation && !isCinema && (
          <MobileHeader
            showBackButton={['/play', '/live'].includes(activePath)}
          />
        )}

        {/* 主要布局容器 */}
        <div
          className={`relative z-10 flex md:grid ${
            isCinema ? 'md:grid-cols-1' : 'md:grid-cols-[auto_1fr]'
          } w-full min-h-screen md:min-h-auto`}
        >
          {/* 侧边栏 - 桌面端显示，移动端隐藏 */}
          {!hideNavigation && !isCinema && (
            <div className='hidden md:block'>
              <Sidebar activePath={activePath} />
            </div>
          )}

          {/* 主内容区域 */}
          <div className='relative min-w-0 flex-1 transition-all duration-300'>
            {/* 桌面端左上角返回按钮 */}
            {!hideNavigation &&
              !isCinema &&
              ['/play', '/live'].includes(activePath) && (
                <div className='absolute top-3 left-1 z-20 hidden md:flex'>
                  <BackButton />
                </div>
              )}

            {/* 桌面端更新通知 */}
            {!hideNavigation && !isCinema && (
              <div className='absolute top-2 right-4 z-20 hidden md:flex items-center gap-2'>
                <UpdateNotification />
              </div>
            )}

            {/* 主内容 */}
            <main
              data-page-content
              className='flex-1 md:min-h-0 mb-14 md:mb-0 md:mt-0 mt-[calc(3rem+env(safe-area-inset-top))]'
              style={{
                paddingBottom: 'calc(3.5rem + env(safe-area-inset-bottom))',
              }}
            >
              {children}
            </main>
          </div>
        </div>

        {/* 移动端底部导航 */}
        {!hideNavigation && (
          <div className='md:hidden'>
            <MobileBottomNav activePath={activePath} />
          </div>
        )}
      </div>
    </VersionCheckProvider>
  );
};

export default PageLayout;
