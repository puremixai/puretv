/* Shared Workbox policy for both Webpack and Turbopack output. */
const runtimeCaching = [
  {
    // Authenticated responses must always follow the current network session.
    urlPattern: ({ url, request, sameOrigin }) =>
      sameOrigin &&
      !url.pathname.includes('/__puretv_idb_video__/') &&
      (/(?:^|\/)api(?:\/|$)/.test(url.pathname) ||
        /\/_next\/data\//.test(url.pathname) ||
        url.searchParams.has('_rsc') ||
        request.mode === 'navigate' ||
        request.destination === 'document' ||
        request.headers.has('RSC') ||
        request.headers.has('Next-Router-State-Tree') ||
        (request.headers.get('accept') || '').includes('text/x-component')),
    handler: 'NetworkOnly',
    method: 'GET',
  },
  {
    urlPattern: ({ url, sameOrigin }) =>
      sameOrigin && url.pathname.includes('/_next/static/'),
    handler: 'CacheFirst',
    options: {
      cacheName: 'puretv-next-static-v1',
      expiration: { maxEntries: 256, maxAgeSeconds: 30 * 86400 },
    },
  },
  {
    urlPattern: /^https:\/\/fonts\.googleapis\.com\//i,
    handler: 'StaleWhileRevalidate',
    options: {
      cacheName: 'google-fonts-stylesheets',
      expiration: { maxEntries: 4, maxAgeSeconds: 7 * 86400 },
    },
  },
  {
    urlPattern: ({ url }) =>
      /^https?:$/.test(url.protocol) &&
      /\.(?:eot|otf|ttc|ttf|woff2?)$/i.test(url.pathname),
    handler: 'StaleWhileRevalidate',
    options: {
      cacheName: 'static-font-assets',
      expiration: { maxEntries: 16, maxAgeSeconds: 30 * 86400 },
    },
  },
  {
    urlPattern: ({ url }) =>
      /^https?:$/.test(url.protocol) &&
      (/\.(?:jpg|jpeg|gif|png|svg|ico|webp|avif)$/i.test(url.pathname) ||
        url.pathname.endsWith('/_next/image')),
    handler: 'StaleWhileRevalidate',
    options: {
      cacheName: 'static-image-assets',
      expiration: { maxEntries: 64, maxAgeSeconds: 86400 },
    },
  },
  {
    urlPattern: ({ url, sameOrigin }) =>
      sameOrigin && /\.(?:js|css|wasm)$/i.test(url.pathname),
    handler: 'StaleWhileRevalidate',
    options: {
      cacheName: 'static-code-assets',
      expiration: { maxEntries: 64, maxAgeSeconds: 86400 },
    },
  },
  {
    urlPattern: ({ url }) =>
      /^https?:$/.test(url.protocol) &&
      !url.pathname.includes('/__puretv_idb_video__/') &&
      /\.(?:mp3|wav|ogg|mp4|webm)$/i.test(url.pathname),
    handler: 'CacheFirst',
    options: {
      rangeRequests: true,
      cacheName: 'static-media-assets',
      expiration: { maxEntries: 32, maxAgeSeconds: 86400 },
    },
  },
];

// This is emitted into sw.js. It does not touch IndexedDB video downloads.
// Old next-pwa "others"/"next-data" entries may contain private HTML or RSC.
function removeLegacyPrivateCaches() {
  self.addEventListener('activate', (event) => {
    event.waitUntil(
      (async () => {
        for (const name of await caches.keys()) {
          const cache = await caches.open(name);
          for (const request of await cache.keys()) {
            const url = new URL(request.url);
            if (
              url.origin !== self.location.origin ||
              url.pathname.includes('/__puretv_idb_video__/')
            )
              continue;
            const privateData =
              /(?:^|\/)api(?:\/|$)/.test(url.pathname) ||
              /\/_next\/data\//.test(url.pathname) ||
              url.searchParams.has('_rsc') ||
              request.headers.has('RSC') ||
              request.headers.has('Next-Router-State-Tree') ||
              request.mode === 'navigate' ||
              (!url.pathname.includes('/_next/static/') &&
                !/\.(?:js|css|eot|otf|ttc|ttf|woff2?|jpg|jpeg|gif|png|svg|ico|webp|avif|mp3|wav|ogg|mp4|webm|wasm)$/i.test(
                  url.pathname
                ) &&
                !url.pathname.endsWith('/manifest.json') &&
                !url.pathname.endsWith('/manifest.webmanifest'));
            if (privateData) await cache.delete(request);
          }
        }
      })()
    );
  });
}

module.exports = { runtimeCaching, removeLegacyPrivateCaches };
