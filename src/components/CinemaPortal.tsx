'use client';

import { ReactNode, useContext } from 'react';
import { createPortal } from 'react-dom';

import { CinemaPortalContext } from './CinematicScope';

function CinemaPortalContent({ children }: { children: ReactNode }) {
  const cinematic = useContext(CinemaPortalContext);
  return cinematic ? (
    <div className='cinema-ui dark cinema-portal'>{children}</div>
  ) : (
    <>{children}</>
  );
}

/** Preserve the front-end theme across portals without changing the admin theme. */
export function createCinemaPortal(
  children: ReactNode,
  container: Element | DocumentFragment,
  key?: string | null
) {
  return createPortal(
    <CinemaPortalContent>{children}</CinemaPortalContent>,
    container,
    key
  );
}
