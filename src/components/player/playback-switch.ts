import type { PlayRecord, SearchResult } from '@/lib/types';

import {
  type PlaybackPosition,
  createPlaybackPersistenceQueue,
} from './playback-progress';

interface SourceIdentity {
  source: string;
  id: string;
}

export function buildPlaybackSelectionUrl(
  currentUrl: string,
  selection: {
    episodeIndex: number;
    source?: string;
    id?: string;
    title?: string;
    year?: string;
  },
) {
  const url = new URL(currentUrl);
  for (const field of ['source', 'id', 'title', 'year'] as const) {
    if (selection[field] !== undefined)
      url.searchParams.set(field, selection[field]);
  }
  url.searchParams.set('episode', String(selection.episodeIndex + 1));
  return url.toString();
}

export interface SourceSwitchRequest {
  target: SourceIdentity & { title: string };
  previous: SourceIdentity &
    PlaybackPosition & {
      episodeIndex: number;
      contentKey: string | null;
      episodeCount: number;
      title: string;
    };
  searchTitle: string;
}

export interface SourcePresentation {
  detail: SearchResult;
  title: string;
  cover: string;
  description: string;
}

export interface SourceSwitchPlan extends SourcePresentation {
  target: SourceIdentity;
  contentKey: string | null;
  episodeIndex: number;
  resumeTime: number | null;
  sameEpisode: boolean;
}

interface SourceMigration {
  from: SourceIdentity;
  to: SourceIdentity;
  record: PlayRecord;
}

interface SourceSwitchPorts {
  loadDetail: (target: SourceSwitchRequest['target']) => Promise<SearchResult>;
  contentKey: (detail: SearchResult) => string | null;
  presentation: (detail: SearchResult) => SourcePresentation;
  readRecord: (
    source: SourceIdentity,
  ) => Promise<Pick<PlayRecord, 'index' | 'play_time'> | null>;
  loadLocal: (key: string | null, episodeIndex: number) => number | null;
  commit: (plan: SourceSwitchPlan) => void;
  transferSkip: (from: SourceIdentity, to: SourceIdentity) => Promise<void>;
  saveLocal: (
    key: string | null,
    episodeIndex: number,
    time: number,
    duration: number,
  ) => void;
  migrate: (migration: SourceMigration) => Promise<void>;
  clearDanmaku: (title: string) => Promise<unknown>;
  onError: (error: unknown) => void;
  onPersistenceError: (error: unknown) => void;
}

const playableTime = (time: number | null | undefined): time is number =>
  typeof time === 'number' && Number.isFinite(time) && time > 1;

/** Resolve only the departed episode's progress; never read mutable page refs after await. */
async function sourceResumeTime(
  request: SourceSwitchRequest,
  ports: SourceSwitchPorts,
  episodeIndex: number,
  contentKey: string | null,
) {
  const previous = request.previous;
  if (episodeIndex !== previous.episodeIndex)
    return ports.loadLocal(contentKey, episodeIndex);
  if (playableTime(previous.currentTime)) return previous.currentTime;
  if (!previous.source || !previous.id) return null;
  try {
    const record = await ports.readRecord({
      source: previous.source,
      id: previous.id,
    });
    if (
      record &&
      record.index - 1 === episodeIndex &&
      playableTime(record.play_time)
    )
      return record.play_time;
  } catch (error) {
    ports.onPersistenceError(error);
  }
  return ports.loadLocal(previous.contentKey, episodeIndex);
}

/** One coordinator per mounted player: stale preparation cannot commit over a newer choice. */
export function createPlaybackSwitchCoordinator() {
  let revision = 0;
  const enqueuePersistence = createPlaybackPersistenceQueue();

  return {
    enqueuePersistence,
    cancel() {
      revision++;
    },
    switchEpisode(
      input: EpisodeSwitchInput,
      ports: {
        loadLocal: (key: string | null, index: number) => number | null;
        saveDeparting: () => void;
        commit: (
          plan: NonNullable<ReturnType<typeof createEpisodeSwitchPlan>>,
        ) => void;
      },
    ) {
      const plan = createEpisodeSwitchPlan(input, ports.loadLocal);
      if (!plan) return false;
      revision++;
      ports.saveDeparting();
      ports.commit(plan);
      return true;
    },
    async switchSource(request: SourceSwitchRequest, ports: SourceSwitchPorts) {
      const currentRevision = ++revision;
      const isCurrent = () => currentRevision === revision;
      try {
        const detail = await ports.loadDetail(request.target);
        if (!isCurrent()) return;
        const episodeIndex =
          request.previous.episodeIndex < detail.episodes.length
            ? request.previous.episodeIndex
            : 0;
        const contentKey = ports.contentKey(detail);
        const resumeTime = await sourceResumeTime(
          request,
          ports,
          episodeIndex,
          contentKey,
        );
        if (!isCurrent()) return;
        const presentation = ports.presentation(detail);
        const plan: SourceSwitchPlan = {
          ...presentation,
          target: request.target,
          contentKey,
          episodeIndex,
          resumeTime,
          sameEpisode: episodeIndex === request.previous.episodeIndex,
        };
        // Publish the complete selection together. Persistence never owns UI state.
        ports.commit(plan);
        if (
          request.previous.episodeCount > 0 &&
          detail.episodes.length > 0 &&
          request.previous.episodeCount !== detail.episodes.length
        ) {
          void ports
            .clearDanmaku(request.previous.title)
            .catch(ports.onPersistenceError);
        }
        if (plan.sameEpisode && playableTime(resumeTime)) {
          ports.saveLocal(
            contentKey,
            episodeIndex,
            resumeTime,
            request.previous.duration,
          );
        }

        const persist = async () => {
          const from = {
            source: request.previous.source,
            id: request.previous.id,
          };
          const to = { source: request.target.source, id: request.target.id };
          try {
            await ports.transferSkip(from, to);
          } catch (error) {
            ports.onPersistenceError(error);
          }
          if (!plan.sameEpisode || !playableTime(resumeTime)) return;
          try {
            await ports.migrate({
              from,
              to,
              record: {
                title: plan.title,
                source_name: plan.detail.source_name || '',
                year: plan.detail.year || '',
                cover: plan.cover || '',
                index: episodeIndex + 1,
                total_episodes: plan.detail.episodes.length || 1,
                play_time: Math.floor(resumeTime),
                total_time: Number.isFinite(request.previous.duration)
                  ? Math.floor(request.previous.duration)
                  : 0,
                save_time: Date.now(),
                search_title: request.searchTitle,
              },
            });
          } catch (error) {
            ports.onPersistenceError(error);
          }
        };
        await enqueuePersistence(persist);
      } catch (error) {
        if (isCurrent()) ports.onError(error);
      }
    },
  };
}

interface EpisodeSwitchInput {
  currentIndex: number;
  targetIndex: number;
  totalEpisodes: number;
  contentKey: string | null;
  hasSource: boolean;
}

export function createEpisodeSwitchPlan(
  input: EpisodeSwitchInput,
  loadLocal: (key: string | null, index: number) => number | null,
) {
  if (
    !Number.isInteger(input.targetIndex) ||
    input.targetIndex < 0 ||
    input.targetIndex >= input.totalEpisodes ||
    input.targetIndex === input.currentIndex
  )
    return null;
  return {
    episodeIndex: input.targetIndex,
    resumeTime: input.hasSource
      ? loadLocal(input.contentKey, input.targetIndex)
      : null,
  };
}

export function findNextPlayableEpisode(
  currentIndex: number,
  totalEpisodes: number,
  titles: string[] | undefined,
  isHidden: (title: string) => boolean,
): number | null {
  for (let index = currentIndex + 1; index < totalEpisodes; index++) {
    const title = titles?.[index];
    if (!title || !isHidden(title)) return index;
  }
  return null;
}
