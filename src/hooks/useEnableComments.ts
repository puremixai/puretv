import { useSyncExternalStore } from 'react';

import { getRuntimeConfig } from '@/lib/runtime-config';

export function useEnableComments(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => getRuntimeConfig().EnableComments ?? true,
    () => true
  );
}
