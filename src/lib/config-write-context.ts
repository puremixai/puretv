import { ConfigConflictError } from './config-revisions';
export interface ConfigWriteState {
  version: string | null;
  failure?: { error: string; status: number };
}
// The server registers one AsyncLocalStorage instance shared by route bundles.
// The client can import DbManager without pulling Node's async_hooks into its bundle.
export const configWriteRegistry = globalThis as typeof globalThis & {
  __puretvConfigWrites?: { getStore(): ConfigWriteState | undefined };
};
export function checkMutationVersion(version: number) {
  const state = configWriteRegistry.__puretvConfigWrites?.getStore();
  if (!state) return; // Background writers still use the database CAS.
  if (state.version === null || !/^\d+$/.test(state.version)) {
    state.failure = {
      error: '缺少配置版本，请刷新管理页面后重试。',
      status: 428,
    };
    throw new Error(state.failure.error);
  }
  if (Number(state.version) !== version) {
    state.failure = { error: new ConfigConflictError().message, status: 409 };
    throw new ConfigConflictError();
  }
}
export function recordConfigConflict(error: unknown) {
  const state = configWriteRegistry.__puretvConfigWrites?.getStore();
  if (state && error instanceof ConfigConflictError)
    state.failure = { error: error.message, status: 409 };
}
