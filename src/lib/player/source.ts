import { isNetdiskSource, normalizeNetdiskSource } from '@/lib/netdisk/source';

export const parseSourceForApi = (
  source: string
): { source: string; embyKey?: string } => {
  source = normalizeNetdiskSource(source);
  if (source.startsWith('emby_')) {
    const key = source.substring(5);
    return { source: 'emby', embyKey: key };
  }
  return { source };
};

export const isLazyDetailSource = (source?: string) => {
  if (!source) return false;
  return (
    source === 'openlist' ||
    source === 'emby' ||
    source.startsWith('emby_') ||
    source.startsWith('script:')
  );
};

export const isNetdiskMountSource = (source?: string | null) => {
  if (!source) return false;
  return (
    source === 'openlist' || source === 'xiaoya' || isNetdiskSource(source)
  );
};
