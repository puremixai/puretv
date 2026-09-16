'use client';

import { useEffect, useRef, useState } from 'react';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import {
  BangumiCalendarData,
  GetBangumiCalendarData,
} from '@/lib/bangumi.client';
import { getDoubanCategories } from '@/lib/douban.client';
import { TMDBItem } from '@/lib/tmdb.client';
import { DoubanItem, SearchResult } from '@/lib/types';

interface RecommendationData {
  hotMovies: DoubanItem[];
  hotDuanju: SearchResult[];
  bangumiCalendar: BangumiCalendarData[];
  hotTvShows: DoubanItem[];
  hotVarietyShows: DoubanItem[];
  upcomingContent: TMDBItem[];
}

type ModuleId = keyof RecommendationData;
type Sections = {
  [Id in ModuleId]: {
    data: RecommendationData[Id];
    loading: boolean;
    failed: boolean;
  };
};

export interface HomeModule {
  id: string;
  name: string;
  enabled: boolean;
  order: number;
}

const MODULE_IDS: ModuleId[] = [
  'hotMovies',
  'hotDuanju',
  'bangumiCalendar',
  'hotTvShows',
  'hotVarietyShows',
  'upcomingContent',
];
const CACHE_DURATION = 60 * 60 * 1000;

function emptySections(): Sections {
  return {
    hotMovies: { data: [], loading: true, failed: false },
    hotDuanju: { data: [], loading: true, failed: false },
    bangumiCalendar: { data: [], loading: true, failed: false },
    hotTvShows: { data: [], loading: true, failed: false },
    hotVarietyShows: { data: [], loading: true, failed: false },
    upcomingContent: { data: [], loading: true, failed: false },
  };
}

function getCacheScope(): string {
  const auth = getAuthInfoFromBrowserCookie();
  // Do not reuse recommendation data across accounts, roles, or login sessions.
  // No password, signature, or access token is written into a storage key.
  return encodeURIComponent(
    JSON.stringify([
      auth?.username || '',
      auth?.role || '',
      // Access tokens rotate within the same login. Their refresh expiry is
      // stable until a new login, unlike the access-token timestamp.
      auth?.refreshExpires || auth?.timestamp || 0,
    ])
  );
}

function cacheKey(scope: string, id: ModuleId): string {
  return `homepage_recommendations_v1:${scope}:${id}`;
}

function readCache<Id extends ModuleId>(scope: string, id: Id) {
  try {
    const value = localStorage.getItem(cacheKey(scope, id));
    if (!value) return null;
    const { data, timestamp } = JSON.parse(value);
    if (!Array.isArray(data) || !Number.isFinite(timestamp)) return null;
    return {
      data: data as RecommendationData[Id],
      fresh: timestamp <= Date.now() && Date.now() - timestamp < CACHE_DURATION,
    };
  } catch {
    return null;
  }
}

function writeCache(
  scope: string,
  id: ModuleId,
  data: RecommendationData[ModuleId]
) {
  try {
    localStorage.setItem(
      cacheKey(scope, id),
      JSON.stringify({ data, timestamp: Date.now() })
    );
  } catch {
    // A disabled/full browser cache must not prevent showing fetched content.
  }
}

async function fetchModule<Id extends ModuleId>(
  id: Id,
  signal: AbortSignal
): Promise<RecommendationData[Id]> {
  let data: unknown;
  if (id === 'bangumiCalendar') {
    // Keep the existing public Bangumi calendar cache and proxy fallback chain.
    data = await GetBangumiCalendarData(signal);
  } else if (
    id === 'hotMovies' ||
    id === 'hotTvShows' ||
    id === 'hotVarietyShows'
  ) {
    const result = await getDoubanCategories(
      id === 'hotMovies'
        ? { kind: 'movie', category: '热门', type: '全部' }
        : id === 'hotTvShows'
        ? { kind: 'tv', category: 'tv', type: 'tv' }
        : { kind: 'tv', category: 'show', type: 'show' },
      signal
    );
    if (result.code !== 200) throw new Error('Recommendation request failed');
    data = result.list;
  } else {
    const response = await fetch(
      id === 'hotDuanju' ? '/api/duanju/recommends' : '/api/tmdb/upcoming',
      { signal }
    );
    if (!response.ok)
      throw new Error(`Recommendation request failed: ${response.status}`);
    const result = await response.json();
    if (result.code !== 200) throw new Error('Recommendation request failed');
    data = result.data;
    if (id === 'upcomingContent' && Array.isArray(data)) {
      data = [...data].sort(
        (a: TMDBItem, b: TMDBItem) =>
          new Date(a.release_date || '9999-12-31').getTime() -
          new Date(b.release_date || '9999-12-31').getTime()
      );
    }
  }
  if (!Array.isArray(data)) throw new Error('Invalid recommendation response');
  return data as RecommendationData[Id];
}

export function useHomeRecommendations(
  modules: HomeModule[],
  ready: boolean
): Sections {
  const scope = getCacheScope();
  const [result, setResult] = useState(() => ({
    scope,
    sections: emptySections(),
  }));
  const active = useRef(
    new Map<ModuleId, { scope: string; controller: AbortController }>()
  );
  const enabledKey = modules
    .filter(
      (module) => module.enabled && MODULE_IDS.includes(module.id as ModuleId)
    )
    .sort((a, b) => a.order - b.order)
    .map((module) => module.id)
    .join(',');

  useEffect(() => {
    if (!ready) return;
    const enabledIds = enabledKey ? (enabledKey.split(',') as ModuleId[]) : [];
    for (const [id, request] of active.current) {
      if (request.scope !== scope || !enabledIds.includes(id)) {
        request.controller.abort();
        active.current.delete(id);
      }
    }

    const update = <Id extends ModuleId>(
      id: Id,
      section: {
        data: RecommendationData[Id];
        loading: boolean;
        failed: boolean;
      }
    ) => {
      setResult((previous) => ({
        scope,
        sections: {
          ...(previous.scope === scope ? previous.sections : emptySections()),
          [id]: section,
        },
      }));
    };

    // Start in visual shelf order. Each shelf settles independently; a slow
    // recommendation source cannot hold back the other first-screen content.
    for (const id of enabledIds) {
      if (active.current.has(id)) continue;
      const request = { scope, controller: new AbortController() };
      active.current.set(id, request);
      const cache = readCache(scope, id);
      update(id, { data: cache?.data || [], loading: !cache, failed: false });
      if (cache?.fresh) continue;

      const isCurrent = () =>
        active.current.get(id) === request &&
        !request.controller.signal.aborted &&
        getCacheScope() === scope;

      void fetchModule(id, request.controller.signal)
        .then((data) => {
          if (!isCurrent()) return;
          writeCache(scope, id, data);
          update(id, { data, loading: false, failed: false });
        })
        .catch(() => {
          if (!isCurrent()) return;
          update(id, { data: cache?.data || [], loading: false, failed: true });
        });
    }
  }, [enabledKey, ready, scope]);

  useEffect(() => {
    const requests = active.current;
    return () => {
      for (const request of requests.values()) request.controller.abort();
      requests.clear();
    };
  }, []);

  return result.scope === scope ? result.sections : emptySections();
}
