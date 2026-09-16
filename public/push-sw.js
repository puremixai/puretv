/* PureTV Web Push handlers */

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Remove API entries created by the previous NetworkFirst runtime policy.
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      const requests = await cache.keys();
      await Promise.all(requests.filter(request => {
        const url = new URL(request.url);
        return url.origin === self.location.origin && url.pathname.startsWith('/api/');
      }).map(request => cache.delete(request)));
    }
    await self.clients.claim();
  })());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch (error) {
    payload = { title: 'PureTV', body: event.data.text() };
  }

  const title = payload.title || 'PureTV';
  const options = {
    body: payload.body || payload.message || '',
    icon: '/icons/icon-192x192.png?v=puretv',
    badge: '/icons/icon-192x192.png?v=puretv',
    tag: payload.notificationId || undefined,
    data: {
      url: payload.url || '/',
      notificationId: payload.notificationId,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href;

  event.waitUntil((async () => {
    const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    for (const client of windowClients) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) {
          return client.navigate(targetUrl);
        }
        return;
      }
    }

    if (self.clients.openWindow) {
      return self.clients.openWindow(targetUrl);
    }
  })());
});

/* IndexedDB video cache virtual files
 * Route: /__puretv_idb_video__/<encoded-cache-key>/playlist.m3u8
 *        /__puretv_idb_video__/<encoded-cache-key>/segment_00000.ts
 *        /__puretv_idb_video__/<encoded-cache-key>/key.key
 */
const IDB_VIDEO_DB_NAME = 'PureTVVideoCache';
const IDB_VIDEO_DB_VERSION = 1;
const IDB_VIDEO_ROUTE_PREFIX = '/__puretv_idb_video__';
const IDB_VIDEO_MANIFESTS_STORE = 'manifests';
const IDB_VIDEO_SEGMENTS_STORE = 'segments';
const IDB_VIDEO_ASSETS_STORE = 'assets';

let idbVideoDbPromise = null;

function openIDBVideoCache() {
  if (idbVideoDbPromise) return idbVideoDbPromise;

  idbVideoDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_VIDEO_DB_NAME, IDB_VIDEO_DB_VERSION);

    request.onerror = () => {
      idbVideoDbPromise = null;
      reject(request.error);
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        idbVideoDbPromise = null;
      };
      resolve(db);
    };

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(IDB_VIDEO_MANIFESTS_STORE)) {
        const manifestStore = db.createObjectStore(IDB_VIDEO_MANIFESTS_STORE, {
          keyPath: 'cacheKey',
        });
        manifestStore.createIndex('sourceVideoEpisode', ['source', 'videoId', 'episodeIndex'], {
          unique: true,
        });
        manifestStore.createIndex('completed', 'completed', { unique: false });
        manifestStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(IDB_VIDEO_SEGMENTS_STORE)) {
        const segmentStore = db.createObjectStore(IDB_VIDEO_SEGMENTS_STORE, {
          keyPath: 'id',
        });
        segmentStore.createIndex('cacheKey', 'cacheKey', { unique: false });
      }

      if (!db.objectStoreNames.contains(IDB_VIDEO_ASSETS_STORE)) {
        const assetStore = db.createObjectStore(IDB_VIDEO_ASSETS_STORE, {
          keyPath: 'id',
        });
        assetStore.createIndex('cacheKey', 'cacheKey', { unique: false });
      }
    };
  });

  return idbVideoDbPromise;
}

function idbVideoGet(storeName, key) {
  return openIDBVideoCache().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.get(key);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

function makeIDBVideoSegmentId(cacheKey, index) {
  return `${cacheKey}:segment:${index}`;
}

function makeIDBVideoAssetId(cacheKey, name) {
  return `${cacheKey}:asset:${name}`;
}

function parseIDBVideoRequest(url) {
  if (url.origin !== self.location.origin) return null;
  if (!url.pathname.startsWith(`${IDB_VIDEO_ROUTE_PREFIX}/`)) return null;

  const rest = url.pathname.slice(IDB_VIDEO_ROUTE_PREFIX.length + 1);
  const slashIndex = rest.indexOf('/');
  if (slashIndex <= 0) return null;

  const cacheKey = decodeURIComponent(rest.slice(0, slashIndex));
  const fileName = rest.slice(slashIndex + 1);

  if (!cacheKey || !fileName) return null;

  if (fileName === 'playlist.m3u8') {
    return { cacheKey, type: 'playlist' };
  }

  if (fileName === 'key.key') {
    return { cacheKey, type: 'key' };
  }

  const segmentMatch = fileName.match(/^segment_(\d+)\.ts$/i);
  if (segmentMatch) {
    return {
      cacheKey,
      type: 'segment',
      index: Number(segmentMatch[1]),
    };
  }

  return null;
}

async function handleIDBVideoRequest(info) {
  const manifest = await idbVideoGet(IDB_VIDEO_MANIFESTS_STORE, info.cacheKey);
  if (!manifest || !manifest.completed) {
    return new Response('IndexedDB video cache not found', { status: 404 });
  }

  if (info.type === 'playlist') {
    return new Response(manifest.playlistContent || '', {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  if (info.type === 'segment') {
    const segment = await idbVideoGet(
      IDB_VIDEO_SEGMENTS_STORE,
      makeIDBVideoSegmentId(info.cacheKey, info.index)
    );

    if (!segment || !segment.data) {
      return new Response('IndexedDB video segment not found', { status: 404 });
    }

    return new Response(segment.data, {
      status: 200,
      headers: {
        'Content-Type': segment.data.type || manifest.mimeType || 'video/MP2T',
        'Content-Length': String(segment.size || segment.data.size || 0),
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  if (info.type === 'key') {
    const asset = await idbVideoGet(
      IDB_VIDEO_ASSETS_STORE,
      makeIDBVideoAssetId(info.cacheKey, 'key.key')
    );

    if (!asset || !asset.data) {
      return new Response('IndexedDB video key not found', { status: 404 });
    }

    return new Response(asset.data, {
      status: 200,
      headers: {
        'Content-Type': asset.mimeType || 'application/octet-stream',
        'Content-Length': String(asset.size || asset.data.size || 0),
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  return new Response('Unsupported IndexedDB video cache request', { status: 400 });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const info = parseIDBVideoRequest(url);
  if (!info) return;

  event.respondWith(
    handleIDBVideoRequest(info).catch((error) => {
      console.error('[IndexedDBVideoSW] request failed:', error);
      return new Response('IndexedDB video cache error', { status: 500 });
    })
  );
});
