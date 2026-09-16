'use client';

import { Search } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { deleteMangaShelf, getAllMangaShelf, saveMangaShelf } from '@/lib/db.client';
import { MangaSearchItem, MangaShelfItem, MangaSource } from '@/lib/manga.types';
import { getRuntimeConfig } from '@/lib/runtime-config';

import MangaCard from '@/components/MangaCard';

const MANGA_SEARCH_STATE_KEY = 'manga_search_state';

function MangaCardSkeleton({ withButton = false }: { withButton?: boolean }) {
  return (
    <div className='space-y-2'>
      <div className='overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xs dark:border-gray-800 dark:bg-gray-950'>
        <div className='aspect-3/4 w-full animate-pulse bg-gray-200 dark:bg-gray-800' />
        <div className='space-y-3 p-3'>
          <div className='h-4 w-3/4 animate-pulse rounded-sm bg-gray-200 dark:bg-gray-800' />
          <div className='h-3 w-1/2 animate-pulse rounded-sm bg-gray-200 dark:bg-gray-800' />
        </div>
      </div>
      {withButton && <div className='h-9 w-full animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800' />}
    </div>
  );
}

export default function MangaSearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get('q')?.trim() || '';
  const urlSourceId = searchParams.get('sourceId') || '';

  const [query, setQuery] = useState('');
  const [sources, setSources] = useState<MangaSource[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [results, setResults] = useState<MangaSearchItem[]>([]);
  const [shelf, setShelf] = useState<Record<string, MangaShelfItem>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [lastSearchedQuery, setLastSearchedQuery] = useState('');
  const [lastSearchedSourceId, setLastSearchedSourceId] = useState('');
  const restoredRef = useRef(false);
  const forceNextUrlSearchRef = useRef(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const currentSearchKeyRef = useRef('');
  const pendingResultsRef = useRef<MangaSearchItem[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  const [totalSources, setTotalSources] = useState(0);
  const [completedSources, setCompletedSources] = useState(0);
  const [useFluidSearch, setUseFluidSearch] = useState(true);

  const getCacheKey = useCallback((keyword: string, selectedSourceId: string) => {
    return `manga_search_cache_${selectedSourceId || 'all'}_${keyword.trim()}`;
  }, []);

  const getCachedResults = useCallback(
    (keyword: string, selectedSourceId: string) => {
      if (typeof window === 'undefined' || !keyword.trim()) return null;
      try {
        const cached = sessionStorage.getItem(getCacheKey(keyword, selectedSourceId));
        return cached ? (JSON.parse(cached) as MangaSearchItem[]) : null;
      } catch {
        return null;
      }
    },
    [getCacheKey]
  );

  const setCachedResults = useCallback(
    (keyword: string, selectedSourceId: string, nextResults: MangaSearchItem[]) => {
      if (typeof window === 'undefined' || !keyword.trim()) return;
      try {
        sessionStorage.setItem(getCacheKey(keyword, selectedSourceId), JSON.stringify(nextResults));
      } catch {
        // ignore session cache failures
      }
    },
    [getCacheKey]
  );


  const readFluidSearchSetting = useCallback(() => {
    if (typeof window === 'undefined') return true;
    try {
      const savedFluidSearch = localStorage.getItem('fluidSearch');
      if (savedFluidSearch !== null) return JSON.parse(savedFluidSearch) !== false;
    } catch {
      // ignore invalid localStorage values
    }
    return getRuntimeConfig().FLUID_SEARCH !== false;
  }, []);

  const closeEventSource = useCallback(() => {
    if (eventSourceRef.current) {
      try {
        eventSourceRef.current.close();
      } catch {
        // ignore close failures
      }
      eventSourceRef.current = null;
    }
  }, []);

  const clearPendingResults = useCallback(() => {
    pendingResultsRef.current = [];
    if (flushTimerRef.current) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  const appendBufferedResults = useCallback((nextResults: MangaSearchItem[]) => {
    if (nextResults.length === 0) return;
    pendingResultsRef.current.push(...nextResults);
    if (!flushTimerRef.current) {
      flushTimerRef.current = window.setTimeout(() => {
        const toAppend = pendingResultsRef.current;
        pendingResultsRef.current = [];
        startTransition(() => {
          setResults((prev) => prev.concat(toAppend));
        });
        flushTimerRef.current = null;
      }, 80);
    }
  }, []);

  const saveSearchState = useCallback((nextState: { query: string; sourceId: string; results: MangaSearchItem[] }) => {
    if (typeof window === 'undefined') return;
    try {
      sessionStorage.setItem(MANGA_SEARCH_STATE_KEY, JSON.stringify(nextState));
    } catch {
      // ignore session cache failures
    }
  }, []);

  const restoreSearchState = useCallback(() => {
    if (typeof window === 'undefined') return null;
    try {
      const cached = sessionStorage.getItem(MANGA_SEARCH_STATE_KEY);
      return cached
        ? (JSON.parse(cached) as {
            query: string;
            sourceId: string;
            results: MangaSearchItem[];
          })
        : null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    setUseFluidSearch(readFluidSearchSetting());

    fetch('/api/manga/sources')
      .then((res) => res.json())
      .then((data) => setSources(data.sources || []))
      .catch(() => undefined);

    getAllMangaShelf().then(setShelf).catch(() => undefined);

    return () => {
      closeEventSource();
      clearPendingResults();
    };
  }, [clearPendingResults, closeEventSource, readFluidSearchSetting]);

  const performSearch = useCallback(
    async (keyword: string, selectedSourceId: string, options?: { forceRefresh?: boolean }) => {
      const trimmedQuery = keyword.trim();
      if (!trimmedQuery) return;
      const normalizedSourceId = selectedSourceId || '';
      const searchKey = `${normalizedSourceId}::${trimmedQuery}`;
      const forceRefresh = options?.forceRefresh === true;

      closeEventSource();
      clearPendingResults();
      currentSearchKeyRef.current = searchKey;

      setLoading(true);
      setError('');
      setHasSearched(true);
      setLastSearchedQuery(trimmedQuery);
      setLastSearchedSourceId(normalizedSourceId);
      setTotalSources(0);
      setCompletedSources(0);

      const cached = forceRefresh ? null : getCachedResults(trimmedQuery, normalizedSourceId);
      if (cached) {
        setResults(cached);
        saveSearchState({ query: trimmedQuery, sourceId: normalizedSourceId, results: cached });
        setLoading(false);
        setTotalSources(1);
        setCompletedSources(1);
        return;
      }

      setResults([]);

      const currentFluidSearch = readFluidSearchSetting();
      setUseFluidSearch((prev) => (prev === currentFluidSearch ? prev : currentFluidSearch));

      const params = new URLSearchParams({ q: trimmedQuery });
      if (normalizedSourceId) params.set('sourceId', normalizedSourceId);

      if (currentFluidSearch) {
        const es = new EventSource(`/api/manga/search/ws?${params.toString()}`);
        eventSourceRef.current = es;

        es.onmessage = (event) => {
          if (!event.data || currentSearchKeyRef.current !== searchKey) return;
          try {
            const payload = JSON.parse(event.data);
            switch (payload.type) {
              case 'start':
                setTotalSources(payload.totalSources || 0);
                setCompletedSources(0);
                break;
              case 'source_result':
                setCompletedSources((prev) => Math.max(prev + 1, payload.completedSources || 0));
                if (Array.isArray(payload.results) && payload.results.length > 0) {
                  appendBufferedResults(payload.results as MangaSearchItem[]);
                }
                break;
              case 'source_error':
                setCompletedSources((prev) => Math.max(prev + 1, payload.completedSources || 0));
                break;
              case 'error':
                setError(payload.error || '搜索失败');
                setLoading(false);
                closeEventSource();
                break;
              case 'complete': {
                setCompletedSources(payload.completedSources || payload.totalSources || 0);
                if (pendingResultsRef.current.length > 0) {
                  const toAppend = pendingResultsRef.current;
                  pendingResultsRef.current = [];
                  if (flushTimerRef.current) {
                    window.clearTimeout(flushTimerRef.current);
                    flushTimerRef.current = null;
                  }
                  startTransition(() => {
                    setResults((prev) => {
                      const nextResults = prev.concat(toAppend);
                      setCachedResults(trimmedQuery, normalizedSourceId, nextResults);
                      saveSearchState({ query: trimmedQuery, sourceId: normalizedSourceId, results: nextResults });
                      return nextResults;
                    });
                  });
                } else {
                  setResults((prev) => {
                    setCachedResults(trimmedQuery, normalizedSourceId, prev);
                    saveSearchState({ query: trimmedQuery, sourceId: normalizedSourceId, results: prev });
                    return prev;
                  });
                }
                setLoading(false);
                closeEventSource();
                break;
              }
            }
          } catch {
            // ignore malformed SSE payloads
          }
        };

        es.onerror = () => {
          if (currentSearchKeyRef.current !== searchKey) return;
          if (pendingResultsRef.current.length > 0) {
            const toAppend = pendingResultsRef.current;
            pendingResultsRef.current = [];
            if (flushTimerRef.current) {
              window.clearTimeout(flushTimerRef.current);
              flushTimerRef.current = null;
            }
            startTransition(() => {
              setResults((prev) => prev.concat(toAppend));
            });
          }
          setLoading(false);
          closeEventSource();
        };
        return;
      }

      try {
        const res = await fetch(`/api/manga/search?${params.toString()}`);
        const data = await res.json();
        if (currentSearchKeyRef.current !== searchKey) return;
        if (!res.ok) throw new Error(data.error || '搜索失败');
        const nextResults = data.results || [];
        setResults(nextResults);
        setTotalSources(1);
        setCompletedSources(1);
        setCachedResults(trimmedQuery, normalizedSourceId, nextResults);
        saveSearchState({ query: trimmedQuery, sourceId: normalizedSourceId, results: nextResults });
      } catch (err) {
        if (currentSearchKeyRef.current !== searchKey) return;
        setError((err as Error).message);
        setResults([]);
      } finally {
        if (currentSearchKeyRef.current === searchKey) {
          setLoading(false);
        }
      }
    },
    [
      appendBufferedResults,
      clearPendingResults,
      closeEventSource,
      getCachedResults,
      readFluidSearchSetting,
      saveSearchState,
      setCachedResults,
    ]
  );

  useEffect(() => {
    if (!restoredRef.current) {
      restoredRef.current = true;

      if (!urlQuery) {
        const cachedState = restoreSearchState();
        if (cachedState?.query?.trim()) {
          setQuery(cachedState.query);
          setSourceId(cachedState.sourceId || '');
          setResults(cachedState.results || []);
          setHasSearched(true);
          setLastSearchedQuery(cachedState.query);
          setLastSearchedSourceId(cachedState.sourceId || '');
        }
        return;
      }
    }

    setQuery(urlQuery);
    setSourceId(urlSourceId);

    if (!urlQuery) {
      closeEventSource();
      clearPendingResults();
      setResults([]);
      setLoading(false);
      setHasSearched(false);
      setLastSearchedQuery('');
      setLastSearchedSourceId('');
      setTotalSources(0);
      setCompletedSources(0);
      setError('');
      return;
    }

    const forceRefresh = forceNextUrlSearchRef.current;
    forceNextUrlSearchRef.current = false;
    void performSearch(urlQuery, urlSourceId, { forceRefresh });
  }, [clearPendingResults, closeEventSource, performSearch, restoreSearchState, urlQuery, urlSourceId]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;

    const params = new URLSearchParams({ q: trimmedQuery });
    if (sourceId) params.set('sourceId', sourceId);
    const nextUrl = `/manga/search?${params.toString()}`;
    if (urlQuery === trimmedQuery && urlSourceId === sourceId) {
      await performSearch(trimmedQuery, sourceId, { forceRefresh: true });
    } else {
      forceNextUrlSearchRef.current = true;
      router.replace(nextUrl);
    }
  };

  const returnTo = useMemo(() => {
    const params = new URLSearchParams();
    if (lastSearchedQuery) params.set('q', lastSearchedQuery);
    if (lastSearchedSourceId) params.set('sourceId', lastSearchedSourceId);
    const queryString = params.toString();
    return queryString ? `/manga/search?${queryString}` : '/manga/search';
  }, [lastSearchedQuery, lastSearchedSourceId]);

  const toggleShelf = async (item: MangaSearchItem) => {
    const key = `${item.sourceId}+${item.id}`;
    if (shelf[key]) {
      await deleteMangaShelf(item.sourceId, item.id);
      setShelf((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }

    const shelfItem: MangaShelfItem = {
      title: item.title,
      cover: item.cover,
      sourceId: item.sourceId,
      sourceName: item.sourceName,
      mangaId: item.id,
      saveTime: Date.now(),
      description: item.description,
      author: item.author,
      status: item.status,
    };
    await saveMangaShelf(item.sourceId, item.id, shelfItem);
    setShelf((prev) => ({ ...prev, [key]: shelfItem }));
  };

  return (
    <div className='mx-auto max-w-6xl'>
      <form className='mx-auto mb-8 max-w-4xl' onSubmit={handleSearch}>
        <div className='flex flex-col gap-3 lg:flex-row'>
          <div className='flex-1'>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='搜索漫画标题'
              className='w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-hidden transition focus:border-sky-500 dark:border-gray-700 dark:bg-gray-900'
            />
          </div>
          <select
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            className='rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm dark:border-gray-700 dark:bg-gray-900 lg:w-56'
          >
            <option value=''>全部来源</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.displayName || source.name}
              </option>
            ))}
          </select>
          <button className='inline-flex items-center justify-center gap-2 rounded-2xl bg-sky-600 px-6 py-3 text-sm font-medium text-white transition hover:bg-sky-700 lg:w-32'>
            <Search className='h-4 w-4' /> 搜索
          </button>
        </div>
      </form>

      <section>
        <div className='mb-4 flex items-center justify-between gap-3'>
          <h2 className='text-lg font-semibold'>搜索结果{results.length > 0 ? `（${results.length}）` : ''}</h2>
          {loading && useFluidSearch && totalSources > 0 && (
            <span className='text-xs text-gray-500 dark:text-gray-400'>
              搜索中 {completedSources}/{totalSources}
            </span>
          )}
        </div>
        {error && <div className='mb-4 text-sm text-red-500'>{error}</div>}
        {loading && results.length === 0 ? (
          <div className='grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6'>
            {Array.from({ length: 12 }).map((_, index) => (
              <MangaCardSkeleton key={index} withButton />
            ))}
          </div>
        ) : results.length === 0 ? (
          <div className='rounded-2xl bg-gray-50 p-10 text-center text-sm text-gray-500 dark:bg-gray-900/50'>
            {hasSearched ? '没有找到相关漫画' : '请输入关键词开始搜索漫画'}
          </div>
        ) : (
          <div className='grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6'>
            {results.map((item) => {
              const key = `${item.sourceId}+${item.id}`;
              return (
                <div key={key} className='space-y-2'>
                  <MangaCard
                    item={item}
                    href={`/manga/detail?mangaId=${item.id}&sourceId=${item.sourceId}&title=${encodeURIComponent(item.title)}&cover=${encodeURIComponent(item.cover)}&sourceName=${encodeURIComponent(item.sourceName)}&description=${encodeURIComponent(item.description || '')}&author=${encodeURIComponent(item.author || '')}&status=${encodeURIComponent(item.status || '')}&returnTo=${encodeURIComponent(returnTo)}`}
                    subtitle={item.author || item.status || item.description}
                  />
                  <button
                    onClick={() => toggleShelf(item)}
                    className='w-full rounded-2xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 transition hover:border-sky-500 hover:text-sky-600 dark:border-gray-700 dark:text-gray-200'
                  >
                    {shelf[key] ? '移出书架' : '加入书架'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
