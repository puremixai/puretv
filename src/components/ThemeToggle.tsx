/* eslint-disable @typescript-eslint/no-explicit-any,react-hooks/exhaustive-deps */

'use client';

import { Moon, Sun } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useContext, useEffect, useState } from 'react';

import { CinemaPortalContext } from './CinematicScope';

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { setTheme, resolvedTheme } = useTheme();
  const pathname = usePathname();
  const cinematic = useContext(CinemaPortalContext);
  const label = cinematic
    ? resolvedTheme === 'dark'
      ? '切换柔和背景'
      : '切换深邃背景'
    : resolvedTheme === 'dark'
    ? '切换浅色模式'
    : '切换深色模式';

  const setThemeColor = (theme?: string) => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = cinematic
        ? theme === 'dark'
          ? '#090b0f'
          : '#171a20'
        : theme === 'dark'
        ? '#0c111c'
        : '#f9fbfe';
      document.head.appendChild(meta);
    } else {
      meta.setAttribute(
        'content',
        cinematic
          ? theme === 'dark'
            ? '#090b0f'
            : '#171a20'
          : theme === 'dark'
          ? '#0c111c'
          : '#f9fbfe'
      );
    }
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  // 监听主题变化和路由变化，确保主题色始终同步
  useEffect(() => {
    if (mounted) {
      setThemeColor(resolvedTheme);
    }
  }, [mounted, resolvedTheme, pathname, cinematic]);

  if (!mounted) {
    // 渲染一个占位符以避免布局偏移
    return <div className='w-10 h-10' />;
  }

  const toggleTheme = () => {
    // 检查浏览器是否支持 View Transitions API
    const targetTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
    setThemeColor(targetTheme);
    if (!(document as any).startViewTransition) {
      setTheme(targetTheme);
      return;
    }

    (document as any).startViewTransition(() => {
      setTheme(targetTheme);
    });
  };

  return (
    <button
      onClick={toggleTheme}
      className='w-10 h-10 shrink-0 p-2 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-200/50 dark:text-gray-300 dark:hover:bg-gray-700/50 transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-emerald-500'
      aria-label={label}
      title={label}
    >
      {resolvedTheme === 'dark' ? (
        <Sun className='w-full h-full' />
      ) : (
        <Moon className='w-full h-full' />
      )}
    </button>
  );
}
