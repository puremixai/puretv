const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const timestampIDB = require('./worker-indexeddb.cjs');
const { Request, Response, Headers, Blob } = vm.runInThisContext('globalThis');

function createWorkerRuntime(publicDir, scope = '/') {
  const timestampDatabase = new timestampIDB.IDBDatabase();
  const handlers = new Map(),
    cacheStores = new Map(),
    idbStores = new Map(),
    fetchCalls = [];
  let offline = false;
  const origin = 'https://puretv.example.test';
  const requestUrl = (r) =>
    typeof r === 'string' ? new URL(r, origin).href : r.url;
  const caches = {
    keys: async () => [...cacheStores.keys()],
    delete: async (name) => cacheStores.delete(name),
    open: async (name) => {
      if (!cacheStores.has(name)) cacheStores.set(name, new Map());
      const entries = cacheStores.get(name);
      return {
        keys: async () => [...entries.keys()].map((url) => new Request(url)),
        put: async (request, response) =>
          entries.set(requestUrl(request), response.clone()),
        delete: async (request) => entries.delete(requestUrl(request)),
        match: async (request, options = {}) => {
          const target = requestUrl(request);
          let response = entries.get(target);
          if (!response && options.ignoreSearch) {
            const url = new URL(target);
            response = [...entries].find(([key]) => {
              const other = new URL(key);
              return (
                other.origin === url.origin && other.pathname === url.pathname
              );
            })?.[1];
          }
          return response?.clone();
        },
      };
    },
    match: async (request, options = {}) => {
      for (const name of options.cacheName
        ? [options.cacheName]
        : cacheStores.keys()) {
        const response = await (
          await caches.open(name)
        ).match(request, options);
        if (response) return response;
      }
    },
  };
  const idbRequest = (result) => {
    const request = { result };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  };
  class ExtendableEvent {
    constructor(type) {
      this.type = type;
      this.promises = [];
    }
    waitUntil(promise) {
      this.promises.push(Promise.resolve(promise));
    }
  }
  class FetchEvent extends ExtendableEvent {
    constructor(request) {
      super('fetch');
      this.request = request;
    }
    respondWith(response) {
      if (this.response)
        throw new Error('Two service-worker handlers claimed the same request');
      this.response = Promise.resolve(response);
    }
  }
  const context = vm.createContext({
    ...timestampIDB,
    URL,
    URLSearchParams,
    Request,
    Response,
    Headers,
    Blob,
    Promise,
    Map,
    Set,
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    ExtendableEvent,
    FetchEvent,
    location: new URL(scope + 'sw.js', origin),
    origin,
    registration: {
      scope: new URL(scope, origin).href,
      showNotification: async () => {},
    },
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
    addEventListener: (type, handler) => {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(handler);
    },
    caches,
    fetch: async (request) => {
      const url = requestUrl(request);
      fetchCalls.push(url);
      if (offline) throw new Error('Network unavailable');
      const response = new Response('network:' + new URL(url).pathname);
      Object.defineProperty(response, 'url', { value: url });
      return response;
    },
    indexedDB: {
      open: (name) =>
        name === 'workbox-expiration'
          ? timestampIDB.createTimestampDatabase(timestampDatabase)
          : idbRequest({
              close() {},
              transaction: (names) => ({
                objectStore: (name = names[0]) => ({
                  get: (key) => idbRequest(idbStores.get(name)?.get(key)),
                }),
              }),
            }),
    },
  });
  context.self = context;
  context.importScripts = (...urls) => {
    for (const url of urls) {
      const filename = path.basename(new URL(url, context.location).pathname);
      vm.runInContext(
        fs.readFileSync(path.join(publicDir, filename), 'utf8'),
        context,
        { filename }
      );
    }
  };
  vm.runInContext(
    fs.readFileSync(path.join(publicDir, 'sw.js'), 'utf8'),
    context,
    { filename: 'sw.js' }
  );
  async function finish(event) {
    for (let i = 0; i < event.promises.length; i += 1) await event.promises[i];
  }
  async function dispatch(type) {
    const event = new ExtendableEvent(type);
    for (const handler of handlers.get(type) || []) handler(event);
    await finish(event);
  }
  return {
    caches,
    cacheStores,
    fetchCalls,
    idbStores,
    handlers,
    setOffline: (value) => {
      offline = value;
    },
    activate: () => dispatch('activate'),
    install: () => dispatch('install'),
    request: async (pathname, { navigation = false, headers } = {}) => {
      const request = new Request(new URL(pathname, origin), { headers });
      if (navigation)
        Object.defineProperty(request, 'mode', { value: 'navigate' });
      const event = new FetchEvent(request);
      for (const handler of handlers.get('fetch') || []) handler(event);
      const response = await (event.response || context.fetch(request));
      await finish(event);
      return response;
    },
  };
}
module.exports = { createWorkerRuntime };
