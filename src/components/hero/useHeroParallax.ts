'use client';

import { type RefObject, useEffect } from 'react';

interface ParallaxOptions {
  enabled?: boolean;
  scrollRef?: RefObject<HTMLElement | null>;
}

// Scroll only schedules one paint; no React state or render work on each frame.
export function useHeroParallax(
  hostRef: RefObject<HTMLElement | null>,
  { enabled = true, scrollRef }: ParallaxOptions = {},
) {
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const reset = () => host.style.setProperty('--hero-parallax-y', '0px');
    reset();
    if (!enabled) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const touch = window.matchMedia('(pointer: coarse)');
    const scroller = scrollRef?.current;
    const target = scroller || window;
    let frame: number | null = null;

    const cancel = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
    };
    const update = () => {
      frame = null;
      if (document.hidden || reduced.matches || touch.matches) {
        reset();
        return;
      }
      const rect = host.getBoundingClientRect();
      const distance = scroller ? scroller.scrollTop : Math.max(0, -rect.top);
      // Once the artwork has left view, there is no reason to move its layer.
      const height = rect.height || host.offsetHeight;
      if (height > 0 && distance > height) return;
      const shift = Math.min(Math.max(0, distance) * 0.22, 72);
      host.style.setProperty('--hero-parallax-y', `${shift.toFixed(2)}px`);
    };
    const schedule = () => {
      if (document.hidden || reduced.matches || touch.matches) {
        cancel();
        reset();
      } else if (frame === null) {
        frame = window.requestAnimationFrame(update);
      }
    };

    target.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    document.addEventListener('visibilitychange', schedule);
    reduced.addEventListener('change', schedule);
    touch.addEventListener('change', schedule);
    schedule();
    return () => {
      cancel();
      reset();
      target.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('visibilitychange', schedule);
      reduced.removeEventListener('change', schedule);
      touch.removeEventListener('change', schedule);
    };
  }, [enabled, hostRef, scrollRef]);
}
