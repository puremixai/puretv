import type { AdminConfig } from './admin.types';

export class ConfigConflictError extends Error {
  readonly status = 409;
  constructor() {
    super('配置已被其他页面或后台任务更新，请刷新后重新应用更改。');
  }
}
export interface ConfigSnapshot {
  version: number;
  savedAt: string;
  config: AdminConfig;
}
export type StoredAdminConfig = AdminConfig & { _history?: ConfigSnapshot[] };
export function publicConfig(config: StoredAdminConfig): AdminConfig {
  const { _history: _omitted, ...current } = config;
  return JSON.parse(JSON.stringify(current));
}
export function nextConfig(
  current: StoredAdminConfig | null,
  draft: AdminConfig
): StoredAdminConfig {
  if ((draft.ConfigVersion || 0) !== (current?.ConfigVersion || 0))
    throw new ConfigConflictError();
  const history = [...(current?._history || [])];
  if (current)
    history.unshift({
      version: current.ConfigVersion || 0,
      savedAt: current.ConfigUpdatedAt || new Date().toISOString(),
      config: publicConfig(current),
    });
  // Keep at most 20 snapshots and 8 MiB of history, atomically with the current config.
  const retained: ConfigSnapshot[] = [];
  let size = 0;
  for (const entry of history.slice(0, 20)) {
    size += Buffer.byteLength(JSON.stringify(entry));
    if (size > 8 * 1024 * 1024) break;
    retained.push(entry);
  }
  return {
    ...publicConfig(draft),
    ConfigVersion: (current?.ConfigVersion || 0) + 1,
    ConfigUpdatedAt: new Date().toISOString(),
    _history: retained,
  };
}
