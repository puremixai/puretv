/** @jest-environment node */
const { downloadDB } = require('../src/lib/download-db');

const clone = (value) =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));

// IDB boundary double: request success changes only the transaction snapshot;
// completion commits all included stores together, and abort discards all writes.
function createMemoryDatabase(initial = {}) {
  const stores = {
    activeTasks: new Map(
      (initial.activeTasks || []).map((task) => [task.id, clone(task)])
    ),
    completedTasks: new Map(
      (initial.completedTasks || []).map((task) => [task.id, clone(task)])
    ),
  };
  const transactions = [];
  return {
    stores,
    transactions,
    transaction(names, mode) {
      if (mode !== 'readwrite')
        throw new Error('Expected a readwrite transaction');
      const snapshot = Object.fromEntries(
        names.map((name) => [name, new Map(stores[name])])
      );
      const requests = [];
      let finished = false;
      const enqueue = (operation) => {
        const request = { result: undefined, onsuccess: null, onerror: null };
        requests.push(() => {
          request.result = operation();
          request.onsuccess?.({ target: request });
        });
        return request;
      };
      const transaction = {
        names: [...names],
        error: null,
        oncomplete: null,
        onabort: null,
        onerror: null,
        objectStore(name) {
          if (!snapshot[name])
            throw new Error(`${name} is outside this transaction`);
          return {
            get: (id) => enqueue(() => clone(snapshot[name].get(id))),
            put: (value) =>
              enqueue(() => {
                snapshot[name].set(value.id, clone(value));
                return value.id;
              }),
            delete: (id) => enqueue(() => snapshot[name].delete(id)),
          };
        },
        succeedRequests() {
          while (!finished && requests.length) requests.shift()();
        },
        complete() {
          if (finished) throw new Error('Transaction already finished');
          this.succeedRequests();
          for (const name of names) stores[name] = snapshot[name];
          finished = true;
          this.oncomplete?.({ target: this });
        },
        abort(error = new Error('Transaction aborted')) {
          if (finished) throw new Error('Transaction already finished');
          finished = true;
          this.error = error;
          this.onabort?.({ target: this });
        },
        fail(error) {
          this.error = error;
          this.onerror?.({ target: this });
          this.abort(error);
        },
      };
      transactions.push(transaction);
      return transaction;
    },
  };
}

const nextTurn = () => new Promise(setImmediate);
const savedTask = (overrides = {}) => ({
  id: 'download-1',
  url: 'https://video.example/playlist.m3u8',
  title: '影片 第一集',
  type: 'TS',
  status: 'done',
  finishList: [{ title: 'segment.ts', status: 'is-success' }],
  downloadIndex: 1,
  finishNum: 1,
  errorNum: 0,
  source: 'source-a',
  videoId: 'video-a',
  episodeIndex: 0,
  downloadMode: 'indexeddb',
  rangeDownload: {
    isShowRange: false,
    startSegment: 0,
    endSegment: 0,
    targetSegment: 1,
  },
  createdAt: 100,
  ...overrides,
});

const completedTask = () => ({
  id: 'download-1',
  title: '影片 第一集',
  source: 'source-a',
  videoId: 'video-a',
  episodeIndex: 0,
  completedAt: 123456,
  downloadMode: 'indexeddb',
  fileSize: 123,
});

let database;
const originalDatabase = downloadDB.db;

beforeEach(() => {
  database = createMemoryDatabase();
  downloadDB.db = database;
  jest.spyOn(Date, 'now').mockReturnValue(123456);
});

afterEach(() => {
  downloadDB.db = originalDatabase;
  jest.restoreAllMocks();
});

test.each([
  ['indexeddb', undefined, 123456],
  ['filesystem', 45678, 45678],
])(
  'commits a %s terminal task together with its minimum completed record',
  async (downloadMode, completedAt, expectedTime) => {
    const task = savedTask({ downloadMode, completedAt });
    const pending = downloadDB.updateActiveTasks([task], []);
    await nextTurn();
    expect(database.transactions).toHaveLength(1);
    const transaction = database.transactions[0];
    expect(transaction.names).toEqual(
      expect.arrayContaining(['activeTasks', 'completedTasks'])
    );

    transaction.succeedRequests();
    expect(database.stores.activeTasks.size).toBe(0);
    expect(database.stores.completedTasks.size).toBe(0);
    transaction.complete();
    await pending;

    expect(database.stores.activeTasks.get(task.id).status).toBe('done');
    expect(database.stores.completedTasks.get(task.id)).toEqual({
      id: 'download-1',
      title: '影片 第一集',
      source: 'source-a',
      videoId: 'video-a',
      episodeIndex: 0,
      completedAt: expectedTime,
      downloadMode,
    });
  }
);

test('aborting the terminal transaction preserves the previous active task and no completed record', async () => {
  const previous = savedTask({ status: 'pause' });
  database = createMemoryDatabase({ activeTasks: [previous] });
  downloadDB.db = database;
  const pending = downloadDB.updateActiveTasks([savedTask()], []);
  const rejected = expect(pending).rejects.toThrow('disk write aborted');
  await nextTurn();

  expect(database.transactions).toHaveLength(1);
  const transaction = database.transactions[0];
  transaction.succeedRequests();
  transaction.abort(new Error('disk write aborted'));
  await rejected;

  expect(database.stores.activeTasks.get(previous.id)).toEqual(previous);
  expect(database.stores.completedTasks.size).toBe(0);
});

test('does not replace an existing rich completed record with the minimum terminal record', async () => {
  const completed = {
    id: 'download-1',
    title: '影片 第一集',
    source: 'source-a',
    videoId: 'video-a',
    episodeIndex: 0,
    completedAt: 45678,
    downloadMode: 'indexeddb',
    videoTitle: '影片',
    episodeTitle: '第一集',
    fileSize: 987654321,
  };
  database = createMemoryDatabase({ completedTasks: [completed] });
  downloadDB.db = database;
  const pending = downloadDB.updateActiveTasks(
    [savedTask()],
    ['obsolete-task']
  );
  await nextTurn();
  database.transactions[0].complete();
  await pending;

  expect(database.stores.completedTasks.get(completed.id)).toEqual(completed);
  expect(database.stores.activeTasks.get(completed.id).status).toBe('done');
});

test('keeps browser, nonterminal, and invalid episode metadata out of completed tasks', async () => {
  const tasks = [
    { downloadMode: 'browser' },
    { status: 'downloading' },
    { source: ' ' },
    { videoId: undefined },
    { episodeIndex: undefined },
    { episodeIndex: -1 },
    { episodeIndex: 0.5 },
    { episodeIndex: NaN },
  ].map((overrides, index) => savedTask({ ...overrides, id: `task-${index}` }));
  const pending = downloadDB.updateActiveTasks(tasks, []);
  await nextTurn();
  database.transactions[0].complete();
  await pending;

  expect(database.stores.activeTasks.size).toBe(tasks.length);
  expect(database.stores.completedTasks.size).toBe(0);
});

test('saveCompletedTask waits for transaction completion after the put request succeeds', async () => {
  let settled = false;
  const pending = downloadDB.saveCompletedTask(completedTask());
  pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );
  await nextTurn();
  const transaction = database.transactions[0];
  transaction.succeedRequests();
  await nextTurn();

  expect(settled).toBe(false);
  expect(database.stores.completedTasks.size).toBe(0);
  transaction.complete();
  await pending;
  expect(database.stores.completedTasks.get('download-1').fileSize).toBe(123);
});

test.each(['abort', 'fail'])(
  'saveCompletedTask rejects transaction %s even after request success',
  async (failure) => {
    const pending = downloadDB.saveCompletedTask(completedTask());
    const rejected = expect(pending).rejects.toThrow('completion failed');
    await nextTurn();
    const transaction = database.transactions[0];
    transaction.succeedRequests();
    transaction[failure](new Error('completion failed'));

    await rejected;
    expect(database.stores.completedTasks.size).toBe(0);
  }
);
