'use client';

import { useSyncExternalStore } from 'react';

import { getRuntimeConfig } from '@/lib/runtime-config';

/**
 * Hook to get the recommendation data source configuration
 * @returns The recommendation data source setting (Douban, TMDB, Mixed, MixedSmart)
 */
export function useRecommendationDataSource(): string {
  return useSyncExternalStore(
    () => () => undefined,
    () => {
      const configValue = getRuntimeConfig().RecommendationDataSource;
      return typeof configValue === 'string' && configValue ? configValue : 'Mixed';
    },
    () => 'Mixed'
  );
}
