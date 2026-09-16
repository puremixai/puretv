import type { DataSource } from './types';

export type SourceListStatus = 'all' | 'enabled' | 'disabled';
export function filterVideoSources(
  sources: DataSource[],
  query: string,
  status: SourceListStatus
) {
  const text = query.trim().toLowerCase();
  return sources.filter(
    (source) =>
      (status === 'all' ||
        (status === 'disabled' ? !!source.disabled : !source.disabled)) &&
      (!text ||
        [source.name, source.key, source.api].some((value) =>
          value.toLowerCase().includes(text)
        ))
  );
}
