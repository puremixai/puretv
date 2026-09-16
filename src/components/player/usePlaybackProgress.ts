'use client';

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

import {
  type ProgressPersistence,
  type ProgressSnapshot,
  createProgressSaver,
} from './playback-progress';

interface PlaybackProgressOptions extends ProgressPersistence {
  capture: () => ProgressSnapshot | null;
  onSaved?: () => void;
  onError?: (error: unknown) => void;
  onExit?: () => void;
  onHidden?: () => void;
  onVisible?: () => void;
}

/** Keep event listeners stable while reading the current selection at event time. */
export function usePlaybackProgress(options: PlaybackProgressOptions) {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  }, [options]);
  const saver = useRef<ReturnType<typeof createProgressSaver> | null>(null);

  const save = useCallback(async () => {
    try {
      const snapshot = latest.current.capture();
      if (!snapshot) return;
      if (saver.current === null) {
        saver.current = createProgressSaver({
          saveLocal: (value) => latest.current.saveLocal(value),
          persist: (value) => latest.current.persist(value),
          enqueue: latest.current.enqueue
            ? (operation) => latest.current.enqueue!(operation)
            : undefined,
        });
      }
      await saver.current.save(snapshot);
      latest.current.onSaved?.();
    } catch (error) {
      latest.current.onError?.(error);
    }
  }, []);

  useEffect(() => {
    const exit = () => {
      // save() captures and writes locally before cleanup can destroy the player.
      void save();
      latest.current.onExit?.();
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') {
        void save();
        latest.current.onHidden?.();
      } else if (document.visibilityState === 'visible') {
        latest.current.onVisible?.();
      }
    };
    window.addEventListener('beforeunload', exit);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      // Client-side navigation may unmount without firing beforeunload.
      void save();
      window.removeEventListener('beforeunload', exit);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [save]);

  return save;
}
