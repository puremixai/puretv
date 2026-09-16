import { isAnimeCategoryText } from '@/lib/anime-keyword-expr';
import type { PlayRecord, SearchResult } from '@/lib/types';

export interface PlaybackPosition {
  currentTime: number;
  duration: number;
}

/** The old ArtPlayer can outlive a selection change until the new media is ready. */
export function createPlaybackProgressGuard() {
  let suspended = true;
  let revision = 0;
  return {
    suspend() {
      suspended = true;
      revision++;
    },
    revision() {
      return revision;
    },
    isCurrent(ticket: number) {
      return ticket === revision;
    },
    resume(ticket: number) {
      if (ticket !== revision) return false;
      suspended = false;
      return true;
    },
    canCapture() {
      return !suspended;
    },
    sourcePosition(
      position: PlaybackPosition,
      plannedResume: number | null,
    ): PlaybackPosition {
      if (!suspended) return position;
      return {
        currentTime:
          plannedResume !== null &&
          Number.isFinite(plannedResume) &&
          plannedResume > 1
            ? plannedResume
            : 0,
        duration: 0,
      };
    },
  };
}

export type PlaybackProgressGuard = ReturnType<
  typeof createPlaybackProgressGuard
>;

interface ProgressInput extends PlaybackPosition {
  source: string;
  id: string;
  contentKey: string | null;
  episodeIndex: number;
  title: string;
  searchTitle: string;
  detail: SearchResult | null;
}

export interface ProgressSnapshot extends PlaybackPosition {
  source: string;
  id: string;
  contentKey: string | null;
  episodeIndex: number;
  record: PlayRecord;
}

/** Capture identity and media position together, before any asynchronous work. */
export function createProgressSnapshot(
  input: ProgressInput,
  now = Date.now(),
): ProgressSnapshot | null {
  if (
    !input.source ||
    !input.id ||
    !input.title ||
    !input.detail?.source_name ||
    !Number.isFinite(input.currentTime) ||
    input.currentTime < 1 ||
    !Number.isFinite(input.duration) ||
    input.duration <= 0 ||
    !Number.isInteger(input.episodeIndex) ||
    input.episodeIndex < 0
  )
    return null;

  const {
    source,
    id,
    contentKey,
    episodeIndex,
    currentTime,
    duration,
    detail,
  } = input;
  return {
    source,
    id,
    contentKey,
    episodeIndex,
    currentTime,
    duration,
    record: {
      title: input.title,
      source_name: detail.source_name,
      year: detail.year || '',
      cover: detail.poster || '',
      index: episodeIndex + 1,
      total_episodes: detail.episodes.length || 1,
      play_time: Math.floor(currentTime),
      total_time: Math.floor(duration),
      save_time: now,
      search_title: input.searchTitle,
      is_anime: isAnimeCategoryText(detail.type_name, detail.class),
    },
  };
}

export interface ProgressPersistence {
  saveLocal: (snapshot: ProgressSnapshot) => void;
  persist: (snapshot: ProgressSnapshot) => Promise<void>;
  enqueue?: (operation: () => Promise<void>) => Promise<void>;
}

/** Progress saves and source migrations can share one chronological queue. */
export function createPlaybackPersistenceQueue() {
  let pending = Promise.resolve();
  return (operation: () => Promise<void>) => {
    const result = pending.then(operation);
    pending = result.catch(() => undefined);
    return result;
  };
}

/** Local storage is synchronous; remote writes retain the capture order. */
export function createProgressSaver(persistence: ProgressPersistence) {
  const enqueue = persistence.enqueue || createPlaybackPersistenceQueue();
  let lastSaved: string | null = null;
  let lastQueued: { key: string; operation: Promise<void> } | null = null;

  return {
    save(snapshot: ProgressSnapshot | null): Promise<void> {
      if (!snapshot) return Promise.resolve();
      // Even a duplicate or queued request must leave an immediate local checkpoint.
      persistence.saveLocal(snapshot);
      const key = JSON.stringify([
        snapshot.source,
        snapshot.id,
        snapshot.episodeIndex,
        snapshot.record.play_time,
        snapshot.record.total_time,
      ]);
      if (lastQueued?.key === key) return lastQueued.operation;
      if (key === lastSaved && !lastQueued) return Promise.resolve();

      const operation = enqueue(async () => {
        await persistence.persist(snapshot);
        lastSaved = key;
      });
      lastQueued = { key, operation };
      void operation
        .finally(() => {
          if (lastQueued?.operation === operation) lastQueued = null;
        })
        .catch(() => undefined);
      return operation;
    },
  };
}
