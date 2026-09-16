// Minimal browser IDB boundary used by the real generated Workbox expiration
// plugin. Video-cache requests use their separate fixture in worker-runtime.
class Events {
  constructor() {
    this.listeners = new Map();
  }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) {
    this.listeners.get(type)?.delete(callback);
  }
  dispatch(type) {
    for (const listener of this.listeners.get(type) || [])
      listener({ target: this });
  }
}

class IDBRequest extends Events {
  constructor(operation) {
    super();
    queueMicrotask(() => {
      this.result = operation();
      this.dispatch('success');
    });
  }
}

class IDBCursor {
  constructor(request, values) {
    this.request = request;
    this.values = values;
    this.value = values.shift();
  }
  continue() {
    queueMicrotask(() => {
      this.value = this.values.shift();
      this.request.result = this.value ? this : null;
      this.request.dispatch('success');
    });
  }
}

class IDBIndex {
  constructor(records) {
    this.records = records;
  }
  openCursor() {
    const request = new IDBRequest(() => {
      const values = [...this.records.values()].sort(
        (a, b) => b.timestamp - a.timestamp
      );
      return values.length ? new IDBCursor(request, values) : null;
    });
    return request;
  }
}

class IDBObjectStore {
  constructor(records) {
    this.records = records;
  }
  put(value) {
    return new IDBRequest(() => {
      this.records.set(value.id, value);
      return value.id;
    });
  }
  get(id) {
    return new IDBRequest(() => this.records.get(id));
  }
  delete(id) {
    return new IDBRequest(() => this.records.delete(id));
  }
  index() {
    return new IDBIndex(this.records);
  }
}

class IDBTransaction extends Events {
  constructor(name, records) {
    super();
    this.objectStoreNames = [name];
    this.records = records;
    setTimeout(() => this.dispatch('complete'), 0);
  }
  objectStore() {
    return new IDBObjectStore(this.records);
  }
}

class IDBDatabase extends Events {
  constructor() {
    super();
    this.records = new Map();
  }
  transaction(name) {
    return new IDBTransaction(name, this.records);
  }
}

function createTimestampDatabase(database) {
  return new IDBRequest(() => database);
}

module.exports = {
  IDBRequest,
  IDBDatabase,
  IDBTransaction,
  IDBObjectStore,
  IDBIndex,
  IDBCursor,
  createTimestampDatabase,
};
