import { NextRequest } from 'next/server';

import { getAvailableApiSites, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { getProxyToken } from '@/lib/emby-token';
import { hasFeaturePermission } from '@/lib/permissions';
import {
  executeSavedSourceScript,
  listEnabledSourceScripts,
  normalizeScriptSearchResults,
  normalizeScriptSources,
} from '@/lib/source-script';
import { SearchResult } from '@/lib/types';
import { yellowWords } from '@/lib/yellow';

import {
  checkSearchSignal,
  mapSearchTasks,
  searchScope,
  searchSourcePool,
} from './search-control';
import { sourceWeightMap } from './source-health';

interface SearchTask {
  id: string;
  name: string;
  run: (signal: AbortSignal) => Promise<SearchResult[]>;
}
export interface SearchPlan {
  tasks: SearchTask[];
  filter: (results: SearchResult[]) => SearchResult[];
}
export interface SearchEvent {
  type: 'source_result' | 'source_error';
  source: string;
  sourceName: string;
  results: SearchResult[];
  error?: string;
}

export async function buildSearchPlan(
  request: NextRequest,
  username: string,
  query: string,
  onlySource?: string
): Promise<SearchPlan> {
  const config = await getConfig();
  const privateOnly =
    request.nextUrl.searchParams.get('privateOnly') === '1' && !onlySource;
  const sites = privateOnly
    ? []
    : await getAvailableApiSites(
        username,
        request.nextUrl.searchParams.get('special') === '1'
      );
  const weights = await sourceWeightMap(config.SourceConfig);
  const tasks: SearchTask[] = sites
    .filter((site) => !onlySource || site.key === onlySource)
    .map((site) => ({
      id: site.key,
      name: site.name,
      run: (signal) => searchFromApi(site, query, signal),
    }));

  if (!onlySource) {
    const [canOpenList, canEmby] = await Promise.all([
      hasFeaturePermission(username, 'private_library'),
      hasFeaturePermission(username, 'emby'),
    ]);
    if (canEmby) {
      const { embyManager } = await import('@/lib/emby-manager');
      const sources = Array.from((await embyManager.getAllClients()).values());
      const proxyToken = sources.length
        ? await getProxyToken(request)
        : undefined;
      for (const { client, config: source } of sources) {
        const id = sources.length === 1 ? 'emby' : `emby_${source.key}`;
        const name = sources.length === 1 ? 'Emby' : source.name;
        tasks.push({
          id,
          name,
          async run(signal) {
            const result = await client.getItems(
              {
                searchTerm: query,
                IncludeItemTypes: 'Movie,Series',
                Recursive: true,
                Fields: 'Overview,ProductionYear',
                Limit: 50,
              },
              signal
            );
            return result.Items.map((item) => ({
              id: item.Id,
              source: id,
              source_name: name,
              title: item.Name,
              poster: client.getImageUrl(
                item.Id,
                'Primary',
                undefined,
                client.isProxyEnabled() ? proxyToken || undefined : undefined
              ),
              episodes: [],
              episodes_titles: [],
              year: item.ProductionYear?.toString() || '',
              desc: item.Overview || '',
              type_name: item.Type === 'Movie' ? '电影' : '电视剧',
              douban_id: 0,
            }));
          },
        });
      }
    }
    if (
      canOpenList &&
      config.OpenListConfig?.Enabled &&
      config.OpenListConfig.URL &&
      config.OpenListConfig.Username &&
      config.OpenListConfig.Password
    ) {
      tasks.push({
        id: 'openlist',
        name: '私人影库',
        async run(signal) {
          const { getCachedMetaInfo, setCachedMetaInfo } = await import(
            '@/lib/openlist-cache'
          );
          const { getTMDBImageUrl } = await import('@/lib/tmdb.search');
          const { db } = await import('@/lib/db');
          let meta = getCachedMetaInfo();
          if (!meta) {
            const raw = await db.getGlobalValue('video.metainfo');
            if (raw) {
              meta = JSON.parse(raw);
              if (meta) setCachedMetaInfo(meta);
            }
          }
          checkSearchSignal(signal);
          const keyword = query.toLowerCase();
          return Object.entries(meta?.folders || {})
            .filter(
              ([key, info]) =>
                (info.folderName || key).toLowerCase().includes(keyword) ||
                (info.title || '').toLowerCase().includes(keyword)
            )
            .map(([key, info]) => ({
              id: key,
              source: 'openlist',
              source_name: '私人影库',
              title: info.title,
              poster: getTMDBImageUrl(info.poster_path),
              episodes: [],
              episodes_titles: [],
              year: (info.release_date || '').split('-')[0],
              desc: info.overview,
              type_name: info.media_type === 'movie' ? '电影' : '电视剧',
              douban_id: 0,
            }));
        },
      });
    }
  }

  const scripts = privateOnly ? [] : await listEnabledSourceScripts();
  for (const script of scripts.filter(
    (item) => !onlySource || item.key === onlySource
  )) {
    tasks.push({
      id: `script:${script.key}`,
      name: script.name,
      async run(signal) {
        const execution = await executeSavedSourceScript({
          key: script.key,
          hook: 'getSources',
          payload: {},
          signal,
        });
        const sources = normalizeScriptSources(execution.result);
        const results = await mapSearchTasks(
          sources,
          signal,
          async (source) => {
            const value = await executeSavedSourceScript({
              key: script.key,
              hook: 'search',
              payload: { keyword: query, page: 1, sourceId: source.id },
              signal,
            });
            return normalizeScriptSearchResults({
              scriptKey: script.key,
              scriptName: script.name,
              sourceId: source.id,
              sourceName: source.name,
              result: value.result,
            });
          },
          2
        );
        return results.flat();
      },
    });
  }
  tasks.sort((a, b) => (weights.get(b.id) || 0) - (weights.get(a.id) || 0));
  return {
    tasks:
      onlySource && tasks.some((task) => task.id === `script:${onlySource}`)
        ? tasks.filter((task) => task.id === `script:${onlySource}`)
        : tasks,
    filter(results) {
      return results
        .filter(
          (item) =>
            config.SiteConfig.DisableYellowFilter ||
            !yellowWords.some((word) => (item.type_name || '').includes(word))
        )
        .map((item) => ({
          ...item,
          weight: item.weight ?? weights.get(item.source) ?? 0,
        }));
    },
  };
}

export async function runSearchPlan(
  plan: SearchPlan,
  signal: AbortSignal,
  emit: (event: SearchEvent) => void
) {
  await mapSearchTasks(plan.tasks, signal, async (task) => {
    try {
      const results = await searchSourcePool.run(async () => {
        const scope = searchScope(signal, 20000);
        try {
          return await task.run(scope.signal);
        } finally {
          scope.abort();
          scope.dispose();
        }
      }, signal);
      checkSearchSignal(signal);
      emit({
        type: 'source_result',
        source: task.id,
        sourceName: task.name,
        results: plan.filter(results),
      });
    } catch (error) {
      checkSearchSignal(signal);
      emit({
        type: 'source_error',
        source: task.id,
        sourceName: task.name,
        results: [],
        error:
          error instanceof Error && error.name === 'TimeoutError'
            ? '搜索超时'
            : '该源暂时不可用',
      });
    }
  });
}
