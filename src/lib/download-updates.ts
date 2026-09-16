import type { SavedTask } from './download-db';
import type { M3U8DownloadTask } from './m3u8-downloader';

function savedTaskSnapshot(task: M3U8DownloadTask): SavedTask {
  return {
    id: task.id,
    url: task.url,
    title: task.title,
    type: task.type,
    status: task.status,
    finishList: task.finishList.map((segment) => ({ ...segment })),
    downloadIndex: task.downloadIndex,
    finishNum: task.finishNum,
    errorNum: task.errorNum,
    source: task.source,
    videoId: task.videoId,
    episodeIndex: task.episodeIndex,
    downloadMode: task.downloadMode,
    rangeDownload: { ...task.rangeDownload },
    m3u8Content: task.m3u8Content,
    createdAt: task.createdAt || Date.now(),
    segmentLogs: task.segmentLogs.map((log) => ({ ...log })),
  };
}

/** Coalesce noisy segment events; lifecycle changes explicitly flush both queues. */
export function createDownloadUpdates({
  getTasks,
  publish,
  persist,
  onError,
}: {
  getTasks: () => M3U8DownloadTask[];
  publish: (tasks: M3U8DownloadTask[]) => void;
  persist: (tasks: SavedTask[], deletedIds: string[]) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const dirty = new Map<string, M3U8DownloadTask>();
  const deleted = new Set<string>();
  const versions = new Map<string, number>();
  const failed = new Map<string, { version: number; task?: SavedTask }>();
  let uiDirty = false;
  let uiTimer: ReturnType<typeof setTimeout> | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let writes = Promise.resolve();

  const publishLatest = () => {
    clearTimeout(uiTimer);
    uiTimer = undefined;
    if (!uiDirty) return;
    uiDirty = false;
    publish(
      getTasks().map((task) => ({
        ...task,
        finishList: task.finishList.map((segment) => ({ ...segment })),
        rangeDownload: { ...task.rangeDownload },
        segmentLogs: [...task.segmentLogs],
      }))
    );
  };

  const saveLatest = () => {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    if (!dirty.size && !deleted.size && !failed.size) return writes;
    const batch = new Map(failed);
    failed.clear();
    for (const task of dirty.values()) {
      const version = versions.get(task.id)!;
      if (task.downloadMode === 'browser' && task.status === 'done') {
        batch.set(task.id, { version });
      } else {
        batch.set(task.id, { version, task: savedTaskSnapshot(task) });
      }
    }
    for (const id of deleted) {
      batch.set(id, { version: versions.get(id)! });
    }
    const tasks: SavedTask[] = [];
    const deletedIds: string[] = [];
    for (const [id, change] of batch) {
      if (change.task) tasks.push(change.task);
      else deletedIds.push(id);
    }
    dirty.clear();
    deleted.clear();
    // Capture before queuing so later mutations cannot alter an older write.
    writes = writes
      .then(() => persist(tasks, deletedIds))
      .catch((error) => {
        for (const [id, change] of batch) {
          // A later cancel or replacement wins even if it is already queued.
          if (versions.get(id) === change.version) failed.set(id, change);
        }
        // Retry on the next normal save/flush, never in an unbounded timer loop.
        onError(error);
      });
    return writes;
  };

  const schedule = () => {
    uiDirty = true;
    if (uiTimer === undefined) uiTimer = setTimeout(publishLatest, 200);
    if (saveTimer === undefined) saveTimer = setTimeout(saveLatest, 1000);
  };

  return {
    progress(task: M3U8DownloadTask) {
      versions.set(task.id, (versions.get(task.id) || 0) + 1);
      failed.delete(task.id);
      deleted.delete(task.id);
      dirty.set(task.id, task);
      schedule();
    },
    remove(id: string) {
      versions.set(id, (versions.get(id) || 0) + 1);
      failed.delete(id);
      dirty.delete(id);
      deleted.add(id);
      schedule();
    },
    flush(publishUI = true) {
      if (publishUI) publishLatest();
      else {
        clearTimeout(uiTimer);
        uiTimer = undefined;
      }
      return saveLatest();
    },
  };
}
