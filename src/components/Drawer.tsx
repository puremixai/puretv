'use client';

import { X } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import { createCinemaPortal as createPortal } from '@/components/CinemaPortal';

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  position?: 'left' | 'right';
  width?: string;
}

export default function Drawer({
  isOpen,
  onClose,
  title,
  children,
  position = 'right',
  width = 'w-full md:w-96',
}: DrawerProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let animationId: number;
    let timer: NodeJS.Timeout;

    if (isOpen) {
      setIsVisible(true);
      animationId = requestAnimationFrame(() => {
        animationId = requestAnimationFrame(() => {
          setIsAnimating(true);
        });
      });
    } else {
      setIsAnimating(false);
      timer = setTimeout(() => {
        setIsVisible(false);
      }, 300);
    }

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [isOpen]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isVisible) {
      document.addEventListener('keydown', handleEsc);
      return () => document.removeEventListener('keydown', handleEsc);
    }
  }, [isVisible, onClose]);

  if (!isVisible || !mounted) return null;

  const content = (
    <div className='fixed inset-0 z-10000 flex items-center justify-end pointer-events-none'>
      <div
        className={`relative ${width} h-full bg-white dark:bg-gray-900 shadow-2xl flex flex-col transition-transform duration-300 ease-out pointer-events-auto ${
          position === 'right'
            ? isAnimating
              ? 'translate-x-0'
              : 'translate-x-full'
            : isAnimating
              ? 'translate-x-0'
              : '-translate-x-full'
        }`}
      >
        <div className='flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700'>
          <h2 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
            {title}
          </h2>
          <button
            onClick={onClose}
            className='p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors'
          >
            <X size={20} className='text-gray-500 dark:text-gray-400' />
          </button>
        </div>

        <div className='flex-1 overflow-y-auto'>{children}</div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
