const { createDownloadUpdates } = require('../src/lib/download-updates');

function task(id, finishNum = 0) {
  return {
    id,
    title: id,
    url: `https://example.test/${id}.m3u8`,
    type: 'TS',
    status: 'pause',
    downloadMode: 'indexeddb',
    finishNum,
    errorNum: 0,
    downloadIndex: 0,
    finishList: [],
    segmentLogs: [],
    rangeDownload: {},
  };
}

function setup() {
  const stored = new Map();
  let nextFailure;
  let pending;
  let attempts = 0;
  const errors = [];
  const updates = createDownloadUpdates({
    getTasks: () => [],
    publish: () => {},
    persist: async (tasks, deletedIds) => {
      attempts += 1;
      if (pending) await pending;
      if (nextFailure) {
        const error = nextFailure;
        nextFailure = undefined;
        throw error;
      }
      deletedIds.forEach((id) => stored.delete(id));
      tasks.forEach((value) => stored.set(value.id, value));
    },
    onError: (error) => errors.push(error),
  });
  return {
    updates,
    stored,
    errors,
    attempts: () => attempts,
    failNext: () => {
      nextFailure = new Error('Transient IndexedDB failure');
    },
    block: () => {
      let release;
      pending = new Promise((resolve) => {
        release = resolve;
      });
      return () => {
        pending = undefined;
        release();
      };
    },
  };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('a failed cancellation is retried with another task instead of resurrecting after reload', async () => {
  const state = setup();
  state.stored.set('a', task('a'));
  state.failNext();
  state.updates.remove('a');
  await state.updates.flush();
  expect(state.stored.has('a')).toBe(true);
  state.updates.progress(task('b', 3));
  await state.updates.flush();
  expect([...state.stored.keys()]).toEqual(['b']);
  expect(state.stored.get('b').finishNum).toBe(3);
});

test('an explicit flush retries a failed paused snapshot even without new progress', async () => {
  const state = setup();
  state.failNext();
  state.updates.progress(task('a', 7));
  await state.updates.flush();
  await state.updates.flush();
  expect(state.stored.get('a')).toMatchObject({
    status: 'pause',
    finishNum: 7,
  });
});

test('a later cancellation supersedes an older failed write', async () => {
  const state = setup();
  const release = state.block();
  state.failNext();
  state.updates.progress(task('a', 1));
  const oldWrite = state.updates.flush();
  await Promise.resolve();
  state.updates.remove('a');
  const deletion = state.updates.flush();
  release();
  await Promise.all([oldWrite, deletion]);
  await state.updates.flush();
  expect(state.stored.has('a')).toBe(false);
});

test('a later re-created task supersedes an older failed deletion', async () => {
  const state = setup();
  const release = state.block();
  state.failNext();
  state.updates.remove('a');
  const oldWrite = state.updates.flush();
  await Promise.resolve();
  state.updates.progress(task('a', 9));
  const replacement = state.updates.flush();
  release();
  await Promise.all([oldWrite, replacement]);
  await state.updates.flush();
  expect(state.stored.get('a').finishNum).toBe(9);
});

test('failure after another batch is queued remains retryable', async () => {
  const state = setup();
  const release = state.block();
  state.failNext();
  state.updates.progress(task('a', 1));
  const first = state.updates.flush();
  await Promise.resolve();
  state.updates.progress(task('b', 2));
  const second = state.updates.flush();
  release();
  await Promise.all([first, second]);
  await state.updates.flush();
  expect([...state.stored.keys()].sort()).toEqual(['a', 'b']);
});

test('a persistent storage failure does not start an unbounded automatic retry loop', async () => {
  const state = setup();
  state.failNext();
  state.updates.progress(task('a'));
  await state.updates.flush();
  jest.advanceTimersByTime(5 * 60 * 1000);
  await Promise.resolve();
  expect(state.attempts()).toBe(1);
  state.failNext();
  await state.updates.flush();
  expect(state.attempts()).toBe(2);
  expect(state.errors).toHaveLength(2);
});
