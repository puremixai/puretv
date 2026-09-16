import { useSyncExternalStore } from 'react';

import { getRuntimeConfig } from '@/lib/runtime-config';

export function useEnableAIComments(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => Boolean(getRuntimeConfig().AI_COMMENTS_ENABLED),
    () => false
  );
}
