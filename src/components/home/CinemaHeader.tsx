'use client';

import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from '@headlessui/react';
import { Menu, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import Sidebar from '@/components/Sidebar';
import { useSite } from '@/components/SiteProvider';
import { ThemeToggle } from '@/components/ThemeToggle';
import { UpdateNotification } from '@/components/UpdateNotification';
import { UserMenu } from '@/components/UserMenu';

export default function CinemaHeader() {
  const { siteName } = useSite();
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeType =
    pathname === '/douban' ? searchParams.get('type') || 'movie' : null;

  return (
    <>
      <header className='cinema-header'>
        <div className='cinema-brand'>
          <button
            className='cinema-menu-trigger'
            onClick={() => setMenuOpen(true)}
            aria-label='打开完整菜单'
            aria-haspopup='dialog'
            aria-expanded={menuOpen}
            title='完整菜单'
          >
            <Menu size={20} />
          </button>
          <Link href='/' aria-label={`${siteName} 首页`}>
            {siteName}
          </Link>
        </div>
        <nav aria-label='影视内容分类' className='cinema-tabs'>
          <Link href='/' aria-current={pathname === '/' ? 'page' : undefined}>
            精选
          </Link>
          <Link
            href='/douban?type=movie'
            aria-current={activeType === 'movie' ? 'page' : undefined}
          >
            电影
          </Link>
          <Link
            href='/douban?type=tv'
            aria-current={activeType === 'tv' ? 'page' : undefined}
          >
            剧集
          </Link>
          <Link
            href='/douban?type=anime'
            aria-current={activeType === 'anime' ? 'page' : undefined}
          >
            动漫
          </Link>
          <Link
            href='/douban?type=show'
            aria-current={activeType === 'show' ? 'page' : undefined}
          >
            综艺
          </Link>
        </nav>
        <div className='cinema-header-actions'>
          <UpdateNotification />
          <Link
            href='/search'
            className='cinema-search'
            aria-label='搜索电影、剧集'
          >
            <Search size={18} aria-hidden='true' />
            <span>搜索</span>
          </Link>
          <ThemeToggle />
          <UserMenu />
        </div>
      </header>
      <Dialog
        open={menuOpen}
        onClose={setMenuOpen}
        className='cinema-layout cinema-menu-dialog'
      >
        <DialogBackdrop className='cinema-menu-backdrop' />
        <DialogPanel
          className='cinema-menu-panel'
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('a')) setMenuOpen(false);
          }}
        >
          <DialogTitle className='sr-only'>完整导航菜单</DialogTitle>
          <Sidebar
            drawer
            activePath={
              pathname === '/douban' ? `/douban?type=${activeType}` : pathname
            }
            onClose={() => setMenuOpen(false)}
          />
        </DialogPanel>
      </Dialog>
    </>
  );
}
