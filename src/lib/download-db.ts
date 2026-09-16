/**
 * 下载任务数据库管理
 */

export interface SavedTask {
  id: string;
  url: string;
  title: string;
  type: 'TS' | 'MP4';
  status: 'ready' | 'downloading' | 'pause' | 'done' | 'error';
  finishList: Array<{
    title: string;
    status: '' | 'is-downloading' | 'is-success' | 'is-error';
    retryCount?: number;
  }>;
  downloadIndex: number;
  finishNum: number;
  errorNum: number;
  source?: string;
  videoId?: string;
  episodeIndex?: number;
  downloadMode?: 'browser' | 'filesystem' | 'indexeddb';
  rangeDownload: {
    isShowRange: boolean;
    startSegment: number;
    endSegment: number;
    targetSegment: number;
  };
  m3u8Content?: string;
  createdAt: number;
  completedAt?: number;
  segmentLogs?: Array<{
    id: string;
    index: number;
    status:
      | 'queued'
      | 'downloading'
      | 'success'
      | 'retry'
      | 'error'
      | 'timeout'
      | 'aborted';
    message: string;
    timestamp: number;
    retryCount?: number;
    durationMs?: number;
    httpStatus?: number;
  }>;
}

export interface CompletedTask {
  id: string;
  title: string;
  source: string;
  videoId: string;
  episodeIndex: number;
  videoTitle?: string; // 视频总标题
  episodeTitle?: string; // 集数标题
  fileSize?: number; // 文件大小（字节）
  completedAt: number;
  downloadMode: 'browser' | 'filesystem' | 'indexeddb';
}

const DB_NAME = 'PureTV';
const DB_VERSION = 2;
const ACTIVE_TASKS_STORE = 'activeTasks';
const COMPLETED_TASKS_STORE = 'completedTasks';

class DownloadDB {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (this.db) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // 创建 activeTasks 表
        if (!db.objectStoreNames.contains(ACTIVE_TASKS_STORE)) {
          const activeStore = db.createObjectStore(ACTIVE_TASKS_STORE, {
            keyPath: 'id',
          });
          activeStore.createIndex('status', 'status', { unique: false });
          activeStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // 创建 completedTasks 表
        if (!db.objectStoreNames.contains(COMPLETED_TASKS_STORE)) {
          const completedStore = db.createObjectStore(COMPLETED_TASKS_STORE, {
            keyPath: 'id',
          });
          completedStore.createIndex('source', 'source', { unique: false });
          completedStore.createIndex('videoId', 'videoId', { unique: false });
          completedStore.createIndex('completedAt', 'completedAt', {
            unique: false,
          });
          completedStore.createIndex('sourceVideoId', ['source', 'videoId'], {
            unique: false,
          });
        }
      };
    });
  }

  // 保存活动任务
  async saveActiveTask(task: SavedTask): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [ACTIVE_TASKS_STORE],
        'readwrite'
      );
      const store = transaction.objectStore(ACTIVE_TASKS_STORE);
      const request = store.put(task);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // 批量保存活动任务
  async saveActiveTasks(tasks: SavedTask[]): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [ACTIVE_TASKS_STORE],
        'readwrite'
      );
      const store = transaction.objectStore(ACTIVE_TASKS_STORE);

      // 先清空
      store.clear();

      // 再添加
      for (const task of tasks) {
        store.put(task);
      }

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  // 只写变更的任务，并在同一事务内删除取消或替换的记录。
  async updateActiveTasks(
    tasks: SavedTask[],
    deletedIds: string[]
  ): Promise<void> {
    if (!tasks.length && !deletedIds.length) return;
    await this.init();

    const completedTasks: CompletedTask[] = [];
    for (const task of tasks) {
      if (
        task.status !== 'done' ||
        (task.downloadMode !== 'filesystem' &&
          task.downloadMode !== 'indexeddb') ||
        typeof task.source !== 'string' ||
        !task.source.trim() ||
        typeof task.videoId !== 'string' ||
        !task.videoId.trim() ||
        typeof task.episodeIndex !== 'number' ||
        !Number.isInteger(task.episodeIndex) ||
        task.episodeIndex < 0
      ) {
        continue;
      }
      completedTasks.push({
        id: task.id,
        title: task.title,
        source: task.source,
        videoId: task.videoId,
        episodeIndex: task.episodeIndex,
        completedAt: task.completedAt ?? Date.now(),
        downloadMode: task.downloadMode,
      });
    }

    return new Promise((resolve, reject) => {
      // A persisted offline terminal task must already have a completion record
      // before recovery can safely remove it from the active store.
      const transaction = this.db!.transaction(
        completedTasks.length
          ? [ACTIVE_TASKS_STORE, COMPLETED_TASKS_STORE]
          : [ACTIVE_TASKS_STORE],
        'readwrite'
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);

      const store = transaction.objectStore(ACTIVE_TASKS_STORE);
      for (const id of deletedIds) store.delete(id);
      for (const task of tasks) store.put(task);

      if (completedTasks.length) {
        const completedStore = transaction.objectStore(COMPLETED_TASKS_STORE);
        for (const task of completedTasks) {
          const request = completedStore.get(task.id);
          request.onsuccess = () => {
            // Later saves enrich this record with file size and episode titles.
            if (request.result === undefined) completedStore.put(task);
          };
        }
      }
    });
  }

  // 获取所有活动任务
  async getActiveTasks(): Promise<SavedTask[]> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [ACTIVE_TASKS_STORE],
        'readonly'
      );
      const store = transaction.objectStore(ACTIVE_TASKS_STORE);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // 删除活动任务
  async deleteActiveTask(id: string): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [ACTIVE_TASKS_STORE],
        'readwrite'
      );
      const store = transaction.objectStore(ACTIVE_TASKS_STORE);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // 批量删除活动任务
  async deleteActiveTasks(ids: string[]): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [ACTIVE_TASKS_STORE],
        'readwrite'
      );
      const store = transaction.objectStore(ACTIVE_TASKS_STORE);

      for (const id of ids) {
        store.delete(id);
      }

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  // 保存已完成任务
  async saveCompletedTask(task: CompletedTask): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [COMPLETED_TASKS_STORE],
        'readwrite'
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
      transaction.objectStore(COMPLETED_TASKS_STORE).put(task);
    });
  }

  // 获取所有已完成任务
  async getCompletedTasks(): Promise<CompletedTask[]> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [COMPLETED_TASKS_STORE],
        'readonly'
      );
      const store = transaction.objectStore(COMPLETED_TASKS_STORE);
      const index = store.index('completedAt');
      const request = index.openCursor(null, 'prev'); // 按完成时间倒序

      const results: CompletedTask[] = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  // 删除已完成任务
  async deleteCompletedTask(id: string): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [COMPLETED_TASKS_STORE],
        'readwrite'
      );
      const store = transaction.objectStore(COMPLETED_TASKS_STORE);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // 批量删除已完成任务
  async deleteCompletedTasks(ids: string[]): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [COMPLETED_TASKS_STORE],
        'readwrite'
      );
      const store = transaction.objectStore(COMPLETED_TASKS_STORE);

      for (const id of ids) {
        store.delete(id);
      }

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  // 检查是否已下载
  async isDownloaded(
    source: string,
    videoId: string,
    episodeIndex: number
  ): Promise<boolean> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [COMPLETED_TASKS_STORE],
        'readonly'
      );
      const store = transaction.objectStore(COMPLETED_TASKS_STORE);
      const index = store.index('sourceVideoId');
      const request = index.openCursor(IDBKeyRange.only([source, videoId]));

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const task = cursor.value as CompletedTask;
          if (task.episodeIndex === episodeIndex) {
            resolve(true);
            return;
          }
          cursor.continue();
        } else {
          resolve(false);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }
}

export const downloadDB = new DownloadDB();
