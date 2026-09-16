'use client';

import { useEffect } from 'react';

import { logger } from '@/lib/logger';

interface PwaRegistrationProps {
  enabled?: boolean;
  scope?: string;
}

function getDirectoryScope(scope: string): string | null {
  // Root-relative directories keep both URLs independent of the current route.
  if (
    !scope.startsWith('/') ||
    scope.startsWith('//') ||
    /[\s\\?#]|%2f|%5c/i.test(scope)
  ) {
    return null;
  }

  try {
    if (
      scope.split('/').some((segment) => {
        const decoded = decodeURIComponent(segment);
        return decoded === '.' || decoded === '..';
      })
    ) {
      return null;
    }
    const url = new URL(scope, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  } catch {
    return null;
  }
}

export default function PwaRegistration({
  enabled = true,
  scope = '/',
}: PwaRegistrationProps) {
  useEffect(() => {
    if (!enabled || !navigator.serviceWorker?.register) return;
    const directoryScope = getDirectoryScope(scope);
    if (!directoryScope) return;

    const register = async () => {
      try {
        await navigator.serviceWorker.register(`${directoryScope}sw.js`, {
          scope: directoryScope,
          updateViaCache: 'none',
        });
      } catch (error) {
        logger.error('Service worker registration failed:', error);
      }
    };

    if (document.readyState === 'complete') {
      void register();
    } else {
      window.addEventListener('load', register, { once: true });
    }

    return () => window.removeEventListener('load', register);
  }, [enabled, scope]);

  return null;
}
