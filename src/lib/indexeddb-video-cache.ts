import { logger } from '@/lib/logger';
/**
 * IndexedDB 视频缓存（独立库）
 *
 * 注意：视频分片/播放列表不存入现有 PureTV 元信息库，避免大体积 Blob
 * 与任务/用户元信息混在一起。
 */

export const INDEXEDDB_VIDEO_CACHE_DB_NAME = 'PureTVVideoCache';
export const INDEXEDDB_VIDEO_CACHE_DB_VERSION = 1;
export const INDEXEDDB_VIDEO_CACHE_ROUTE_PREFIX = '/__puretv_idb_video__';

const MANIFESTS_STORE = 'manifests';
const SEGMENTS_STORE = 'segments';
const ASSETS_STORE = 'assets';

export interface IndexedDBVideoCacheManifest {
  cacheKey: string;
  source: string;
  videoId: string;
  episodeIndex: number;
  title: string;
  playlistContent: string;
  m3u8Content?: string;
  segmentCount: number;
  totalSize: number;
  completed: boolean;
  createdAt: number;
  updatedAt: number;
  mimeType?: string;
}

interface IndexedDBVideoSegmentRecord {
  id: string;
  cacheKey: string;
  index: number;
  data: Blob;
  size: number;
  updatedAt: number;
}

interface IndexedDBVideoAssetRecord {
  id: string;
  cacheKey: string;
  name: string;
  data: Blob;
  size: number;
  mimeType?: string;
  updatedAt: number;
}

export interface IndexedDBVideoPlaybackResult {
  hasLocal: boolean;
  url?: string;
  manifest?: IndexedDBVideoCacheManifest;
  mode?: 'service-worker' | 'blob';
  objectUrls?: string[];
  reason?: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function buildIndexedDBVideoCacheKey(
  source: string,
  videoId: string,
  episodeIndex: number
): string {
  return `${source}::${videoId}::${episodeIndex}`;
}

function makeSegmentId(cacheKey: string, index: number): string {
  return `${cacheKey}:segment:${index}`;
}

function makeAssetId(cacheKey: string, name: string): string {
  return `${cacheKey}:asset:${name}`;
}

function assertIndexedDBAvailable(): void {
  if (typeof indexedDB === 'undefined') {
    throw new Error('当前环境不支持 IndexedDB');
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function openIndexedDBVideoCache(): Promise<IDBDatabase> {
  assertIndexedDBAvailable();

  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(
      INDEXEDDB_VIDEO_CACHE_DB_NAME,
      INDEXEDDB_VIDEO_CACHE_DB_VERSION
    );

    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(MANIFESTS_STORE)) {
        const manifestStore = db.createObjectStore(MANIFESTS_STORE, {
          keyPath: 'cacheKey',
        });
        manifestStore.createIndex(
          'sourceVideoEpisode',
          ['source', 'videoId', 'episodeIndex'],
          {
            unique: true,
          }
        );
        manifestStore.createIndex('completed', 'completed', { unique: false });
        manifestStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(SEGMENTS_STORE)) {
        const segmentStore = db.createObjectStore(SEGMENTS_STORE, {
          keyPath: 'id',
        });
        segmentStore.createIndex('cacheKey', 'cacheKey', { unique: false });
      }

      if (!db.objectStoreNames.contains(ASSETS_STORE)) {
        const assetStore = db.createObjectStore(ASSETS_STORE, {
          keyPath: 'id',
        });
        assetStore.createIndex('cacheKey', 'cacheKey', { unique: false });
      }
    };
  });

  return dbPromise;
}

export async function getIndexedDBVideoManifestByCacheKey(
  cacheKey: string
): Promise<IndexedDBVideoCacheManifest | undefined> {
  const db = await openIndexedDBVideoCache();
  const tx = db.transaction([MANIFESTS_STORE], 'readonly');
  const store = tx.objectStore(MANIFESTS_STORE);
  return requestToPromise<IndexedDBVideoCacheManifest | undefined>(
    store.get(cacheKey)
  );
}

export async function getIndexedDBVideoManifestByEpisode(
  source: string,
  videoId: string,
  episodeIndex: number
): Promise<IndexedDBVideoCacheManifest | undefined> {
  const db = await openIndexedDBVideoCache();
  const tx = db.transaction([MANIFESTS_STORE], 'readonly');
  const store = tx.objectStore(MANIFESTS_STORE);
  const index = store.index('sourceVideoEpisode');
  return requestToPromise<IndexedDBVideoCacheManifest | undefined>(
    index.get([source, videoId, episodeIndex])
  );
}

export async function isIndexedDBVideoDownloaded(
  source: string,
  videoId: string,
  episodeIndex: number
): Promise<boolean> {
  const manifest = await getIndexedDBVideoManifestByEpisode(
    source,
    videoId,
    episodeIndex
  );
  return Boolean(manifest?.completed && manifest.segmentCount > 0);
}

export async function saveIndexedDBVideoSegment(input: {
  cacheKey: string;
  index: number;
  data: ArrayBuffer | Uint8Array | Blob;
  mimeType?: string;
}): Promise<number> {
  const db = await openIndexedDBVideoCache();
  const blob =
    input.data instanceof Blob
      ? input.data
      : new Blob([input.data], { type: input.mimeType || 'video/MP2T' });

  const record: IndexedDBVideoSegmentRecord = {
    id: makeSegmentId(input.cacheKey, input.index),
    cacheKey: input.cacheKey,
    index: input.index,
    data: blob,
    size: blob.size,
    updatedAt: Date.now(),
  };

  const tx = db.transaction([SEGMENTS_STORE], 'readwrite');
  tx.objectStore(SEGMENTS_STORE).put(record);

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

  return blob.size;
}

export async function saveIndexedDBVideoAsset(input: {
  cacheKey: string;
  name: string;
  data: ArrayBuffer | Uint8Array | Blob;
  mimeType?: string;
}): Promise<number> {
  const db = await openIndexedDBVideoCache();
  const blob =
    input.data instanceof Blob
      ? input.data
      : new Blob([input.data], {
          type: input.mimeType || 'application/octet-stream',
        });

  const record: IndexedDBVideoAssetRecord = {
    id: makeAssetId(input.cacheKey, input.name),
    cacheKey: input.cacheKey,
    name: input.name,
    data: blob,
    size: blob.size,
    mimeType: input.mimeType,
    updatedAt: Date.now(),
  };

  const tx = db.transaction([ASSETS_STORE], 'readwrite');
  tx.objectStore(ASSETS_STORE).put(record);

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

  return blob.size;
}

async function getIndexedDBVideoSegment(
  cacheKey: string,
  index: number
): Promise<IndexedDBVideoSegmentRecord | undefined> {
  const db = await openIndexedDBVideoCache();
  const tx = db.transaction([SEGMENTS_STORE], 'readonly');
  const store = tx.objectStore(SEGMENTS_STORE);
  return requestToPromise<IndexedDBVideoSegmentRecord | undefined>(
    store.get(makeSegmentId(cacheKey, index))
  );
}

async function getIndexedDBVideoAsset(
  cacheKey: string,
  name: string
): Promise<IndexedDBVideoAssetRecord | undefined> {
  const db = await openIndexedDBVideoCache();
  const tx = db.transaction([ASSETS_STORE], 'readonly');
  const store = tx.objectStore(ASSETS_STORE);
  return requestToPromise<IndexedDBVideoAssetRecord | undefined>(
    store.get(makeAssetId(cacheKey, name))
  );
}

export async function getIndexedDBVideoSegments(
  cacheKey: string
): Promise<Array<{ index: number; data: Blob; size: number }>> {
  const db = await openIndexedDBVideoCache();
  const tx = db.transaction([SEGMENTS_STORE], 'readonly');
  const store = tx.objectStore(SEGMENTS_STORE);
  const index = store.index('cacheKey');

  return new Promise((resolve, reject) => {
    const segments: Array<{ index: number; data: Blob; size: number }> = [];
    const request = index.openCursor(IDBKeyRange.only(cacheKey));

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        segments.sort((a, b) => a.index - b.index);
        resolve(segments);
        return;
      }

      const record = cursor.value as IndexedDBVideoSegmentRecord;
      segments.push({
        index: record.index,
        data: record.data,
        size: record.size,
      });
      cursor.continue();
    };

    request.onerror = () => reject(request.error);
  });
}

export async function getIndexedDBVideoCacheSize(
  cacheKey: string
): Promise<number> {
  const manifest = await getIndexedDBVideoManifestByCacheKey(cacheKey);
  if (manifest?.totalSize) return manifest.totalSize;

  const db = await openIndexedDBVideoCache();
  const tx = db.transaction([SEGMENTS_STORE, ASSETS_STORE], 'readonly');

  const sumByIndex = (storeName: string) =>
    new Promise<number>((resolve, reject) => {
      const store = tx.objectStore(storeName);
      const index = store.index('cacheKey');
      const request = index.openCursor(IDBKeyRange.only(cacheKey));
      let total = 0;

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(total);
          return;
        }
        total += Number((cursor.value as { size?: number }).size || 0);
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });

  const [segmentSize, assetSize] = await Promise.all([
    sumByIndex(SEGMENTS_STORE),
    sumByIndex(ASSETS_STORE),
  ]);

  return segmentSize + assetSize;
}

export async function saveIndexedDBVideoManifest(input: {
  cacheKey: string;
  source: string;
  videoId: string;
  episodeIndex: number;
  title: string;
  playlistContent: string;
  m3u8Content?: string;
  segmentCount: number;
  completed: boolean;
  mimeType?: string;
  totalSize?: number;
}): Promise<IndexedDBVideoCacheManifest> {
  const db = await openIndexedDBVideoCache();
  const existing = await getIndexedDBVideoManifestByCacheKey(input.cacheKey);
  const now = Date.now();
  const totalSize =
    typeof input.totalSize === 'number'
      ? input.totalSize
      : await getIndexedDBVideoCacheSize(input.cacheKey);

  const manifest: IndexedDBVideoCacheManifest = {
    cacheKey: input.cacheKey,
    source: input.source,
    videoId: input.videoId,
    episodeIndex: input.episodeIndex,
    title: input.title,
    playlistContent: input.playlistContent,
    m3u8Content: input.m3u8Content,
    segmentCount: input.segmentCount,
    totalSize,
    completed: input.completed,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    mimeType: input.mimeType,
  };

  const tx = db.transaction([MANIFESTS_STORE], 'readwrite');
  tx.objectStore(MANIFESTS_STORE).put(manifest);

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

  return manifest;
}

async function deleteRecordsByCacheKey(
  db: IDBDatabase,
  storeName: string,
  cacheKey: string
): Promise<void> {
  if (!db.objectStoreNames.contains(storeName)) return;

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([storeName], 'readwrite');
    const store = tx.objectStore(storeName);
    const index = store.index('cacheKey');
    const request = index.openCursor(IDBKeyRange.only(cacheKey));

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function deleteIndexedDBVideoCache(
  cacheKey: string
): Promise<void> {
  const db = await openIndexedDBVideoCache();
  await deleteRecordsByCacheKey(db, SEGMENTS_STORE, cacheKey);
  await deleteRecordsByCacheKey(db, ASSETS_STORE, cacheKey);

  const tx = db.transaction([MANIFESTS_STORE], 'readwrite');
  tx.objectStore(MANIFESTS_STORE).delete(cacheKey);

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function deleteIndexedDBVideoCacheByEpisode(
  source: string,
  videoId: string,
  episodeIndex: number
): Promise<void> {
  const manifest = await getIndexedDBVideoManifestByEpisode(
    source,
    videoId,
    episodeIndex
  );
  if (manifest) {
    await deleteIndexedDBVideoCache(manifest.cacheKey);
    return;
  }

  await deleteIndexedDBVideoCache(
    buildIndexedDBVideoCacheKey(source, videoId, episodeIndex)
  );
}

export async function getIndexedDBVideoStorageUsage(): Promise<{
  totalSize: number;
  count: number;
}> {
  const db = await openIndexedDBVideoCache();
  const tx = db.transaction([MANIFESTS_STORE], 'readonly');
  const store = tx.objectStore(MANIFESTS_STORE);
  const request = store.getAll();
  const manifests = await requestToPromise<IndexedDBVideoCacheManifest[]>(
    request
  );

  return manifests.reduce(
    (acc, manifest) => ({
      totalSize: acc.totalSize + Number(manifest.totalSize || 0),
      count: acc.count + (manifest.completed ? 1 : 0),
    }),
    { totalSize: 0, count: 0 }
  );
}

export async function requestIndexedDBVideoPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return false;
  }

  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function getBrowserStorageEstimate(): Promise<StorageEstimate | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return null;
  }

  try {
    return await navigator.storage.estimate();
  } catch {
    return null;
  }
}

function waitForServiceWorkerActivation(
  registration: ServiceWorkerRegistration
): Promise<ServiceWorkerRegistration> {
  const worker =
    registration.installing || registration.waiting || registration.active;

  if (!worker || worker.state === 'activated') {
    return Promise.resolve(registration);
  }

  return new Promise((resolve, reject) => {
    const handleStateChange = () => {
      if (worker.state === 'activated') {
        worker.removeEventListener('statechange', handleStateChange);
        resolve(registration);
      } else if (worker.state === 'redundant') {
        worker.removeEventListener('statechange', handleStateChange);
        reject(new Error('Service Worker 激活失败'));
      }
    };

    worker.addEventListener('statechange', handleStateChange);
    handleStateChange();
  });
}

async function waitForServiceWorkerController(
  timeoutMs = 2500
): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return false;
  }

  if (navigator.serviceWorker.controller) return true;

  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        onControllerChange
      );
      resolve(Boolean(navigator.serviceWorker.controller));
    }, timeoutMs);

    const onControllerChange = () => {
      window.clearTimeout(timer);
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        onControllerChange
      );
      resolve(true);
    };

    navigator.serviceWorker.addEventListener(
      'controllerchange',
      onControllerChange
    );
  });
}

export async function ensureIndexedDBVideoServiceWorker(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined')
    return false;
  if (!('serviceWorker' in navigator)) return false;

  try {
    const registration = await navigator.serviceWorker.register('/push-sw.js', {
      scope: '/',
      updateViaCache: 'none',
    });

    await waitForServiceWorkerActivation(registration);
    return waitForServiceWorkerController();
  } catch (error) {
    logger.warn(
      '[IndexedDBVideo] Service Worker 不可用，降级为 Blob URL 播放:',
      error
    );
    return false;
  }
}

export function getIndexedDBVideoServiceWorkerPlaylistUrl(
  cacheKey: string,
  version?: number
): string {
  const encodedCacheKey = encodeURIComponent(cacheKey);
  const suffix = version ? `?v=${encodeURIComponent(String(version))}` : '';
  return `${INDEXEDDB_VIDEO_CACHE_ROUTE_PREFIX}/${encodedCacheKey}/playlist.m3u8${suffix}`;
}

function isSegmentLine(line: string): boolean {
  return /^segment_\d+\.ts$/i.test(line.trim());
}

function parseSegmentIndex(line: string): number | null {
  const match = line.trim().match(/^segment_(\d+)\.ts$/i);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isFinite(index) ? index : null;
}

export async function createIndexedDBVideoBlobPlaybackUrl(
  cacheKey: string
): Promise<IndexedDBVideoPlaybackResult> {
  const manifest = await getIndexedDBVideoManifestByCacheKey(cacheKey);
  if (!manifest?.completed) {
    return { hasLocal: false, reason: 'IndexedDB 缓存未完成' };
  }

  const objectUrls: string[] = [];
  const lines = manifest.playlistContent.split('\n');
  const modifiedLines: string[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (isSegmentLine(trimmedLine)) {
      const segmentIndex = parseSegmentIndex(trimmedLine);
      if (segmentIndex === null) {
        modifiedLines.push(line);
        continue;
      }

      const segment = await getIndexedDBVideoSegment(cacheKey, segmentIndex);
      if (!segment?.data) {
        objectUrls.forEach((url) => URL.revokeObjectURL(url));
        return {
          hasLocal: false,
          reason: `缺少 IndexedDB 分片 ${segmentIndex + 1}`,
        };
      }

      const segmentUrl = URL.createObjectURL(segment.data);
      objectUrls.push(segmentUrl);
      modifiedLines.push(line.replace(trimmedLine, segmentUrl));
      continue;
    }

    if (trimmedLine === 'key.key') {
      const asset = await getIndexedDBVideoAsset(cacheKey, 'key.key');
      if (asset?.data) {
        const keyUrl = URL.createObjectURL(asset.data);
        objectUrls.push(keyUrl);
        modifiedLines.push(line.replace(trimmedLine, keyUrl));
      } else {
        modifiedLines.push(line);
      }
      continue;
    }

    if (trimmedLine.includes('URI="key.key"')) {
      const asset = await getIndexedDBVideoAsset(cacheKey, 'key.key');
      if (asset?.data) {
        const keyUrl = URL.createObjectURL(asset.data);
        objectUrls.push(keyUrl);
        modifiedLines.push(line.replace('URI="key.key"', `URI="${keyUrl}"`));
      } else {
        modifiedLines.push(line);
      }
      continue;
    }

    modifiedLines.push(line);
  }

  const playlistBlob = new Blob([modifiedLines.join('\n')], {
    type: 'application/vnd.apple.mpegurl',
  });
  const playlistUrl = URL.createObjectURL(playlistBlob);
  objectUrls.push(playlistUrl);

  return {
    hasLocal: true,
    url: playlistUrl,
    manifest,
    mode: 'blob',
    objectUrls,
  };
}

export async function getIndexedDBVideoPlaybackUrl(
  source: string,
  videoId: string,
  episodeIndex: number,
  options: { preferServiceWorker?: boolean } = {}
): Promise<IndexedDBVideoPlaybackResult> {
  try {
    const manifest = await getIndexedDBVideoManifestByEpisode(
      source,
      videoId,
      episodeIndex
    );
    if (!manifest?.completed) {
      return { hasLocal: false, reason: '未找到 IndexedDB 本地缓存' };
    }

    const preferServiceWorker = options.preferServiceWorker !== false;
    if (preferServiceWorker) {
      const serviceWorkerReady = await ensureIndexedDBVideoServiceWorker();
      if (serviceWorkerReady) {
        return {
          hasLocal: true,
          url: getIndexedDBVideoServiceWorkerPlaylistUrl(
            manifest.cacheKey,
            manifest.updatedAt
          ),
          manifest,
          mode: 'service-worker',
        };
      }
    }

    return createIndexedDBVideoBlobPlaybackUrl(manifest.cacheKey);
  } catch (error) {
    logger.error('[IndexedDBVideo] 获取本地播放地址失败:', error);
    return { hasLocal: false, reason: String(error) };
  }
}
