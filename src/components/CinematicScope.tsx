'use client';

import { usePathname } from 'next/navigation';
import { createContext, ReactNode, useEffect } from 'react';

export const CinemaPortalContext = createContext(false);

export default function CinematicScope({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const enabled = pathname !== '/admin' && !pathname.startsWith('/admin/');
  const reading = pathname === '/books/read' || pathname === '/manga/read';
  const section = pathname.split('/')[1] || 'home';

  useEffect(() => {
    if (enabled) document.body.dataset.cinemaUi = reading ? 'reading' : 'true';
    else delete document.body.dataset.cinemaUi;
    return () => {
      delete document.body.dataset.cinemaUi;
    };
  }, [enabled, reading]);

  return (
    <CinemaPortalContext.Provider value={enabled && !reading}>
      {enabled ? (
        <div
          className={`cinema-ui ${reading ? 'cinema-reading' : 'dark'}`}
          data-cinema-section={section}
        >
          {children}
        </div>
      ) : (
        children
      )}
    </CinemaPortalContext.Provider>
  );
}
