const React = require('react');
const { act, render, screen } = require('@testing-library/react');

let mockSavedTasks = new Map();
let mockWrites = [];
let mockPendingWrite;
let mockRestoredTasks = [];
jest.mock('../src/lib/download-db', () => ({
  downloadDB: {
    getActiveTasks: async () => mockRestoredTasks,
    saveActiveTasks: async (tasks) => {
      mockWrites.push(tasks);
      if (mockPendingWrite) await mockPendingWrite;
      mockSavedTasks.clear();
      tasks.forEach((task) => mockSavedTasks.set(task.id, task));
    },
    updateActiveTasks: async (tasks, deletedIds) => {
      mockWrites.push(tasks);
      if (mockPendingWrite) await mockPendingWrite;
      deletedIds.forEach((id) => mockSavedTasks.delete(id));
      tasks.forEach((task) => mockSavedTasks.set(task.id, task));
    },
    saveCompletedTask: async () => {},
    deleteActiveTasks: async (ids) => {
      ids.forEach((id) => mockSavedTasks.delete(id));
    },
  },
}));
jest.mock('../src/lib/indexeddb-video-cache', () => ({
  ...jest.requireActual('../src/lib/indexeddb-video-cache'),
  deleteIndexedDBVideoCache: async () => {},
}));

const downloads = require('../src/contexts/DownloadContext');
const { M3U8Downloader } = require('../src/lib/m3u8-downloader');
let current;
let progressRenders;
let actionRenders;

function Progress() {
  current = downloads.useDownload();
  progressRenders++;
  return React.createElement(
    'output',
    null,
    current.tasks.map((task) => `${task.status}:${task.finishNum}`).join(',')
  );
}

function Actions() {
  downloads.useDownloadActions();
  actionRenders++;
  return null;
}

async function mountTask() {
  render(
    React.createElement(
      downloads.DownloadProvider,
      null,
      React.createElement(Progress),
      React.createElement(Actions)
    )
  );
  await act(async () => {});
  const id = await current.downloader.createTask(
    'https://test/video.m3u8',
    'Video'
  );
  const task = current.downloader.getTask(id);
  task.downloadMode = 'indexeddb';
  task.status = 'downloading';
  return task;
}

function progress(task, finishNum) {
  act(() => {
    task.finishNum = finishNum;
    current.downloader.options.onProgress(task);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockSavedTasks = new Map();
  mockWrites = [];
  mockPendingWrite = undefined;
  mockRestoredTasks = [];
  progressRenders = 0;
  actionRenders = 0;
  jest
    .spyOn(M3U8Downloader.prototype, 'fetchM3U8')
    .mockResolvedValue('#EXTM3U\n#EXTINF:10,\nsegment.ts\n#EXT-X-ENDLIST');
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('a burst of segment events publishes one latest progress view', async () => {
  const task = await mountTask();
  const initialRenders = progressRenders;
  for (let index = 1; index <= 20; index++) progress(task, index);
  await act(async () => jest.advanceTimersByTime(250));
  expect(screen.getByText('downloading:20')).toBeInTheDocument();
  expect(progressRenders - initialRenders).toBeLessThanOrEqual(2);
});

test('progress subscribers update without rerendering action-only consumers', async () => {
  const task = await mountTask();
  const initialRenders = actionRenders;
  progress(task, 1);
  await act(async () => jest.advanceTimersByTime(250));
  expect(screen.getByText('downloading:1')).toBeInTheDocument();
  expect(actionRenders).toBe(initialRenders);
});

test('progress saves are batched and preserve unrelated restored records', async () => {
  const task = await mountTask();
  mockSavedTasks.set('other', { id: 'other', status: 'pause' });
  for (let index = 1; index <= 20; index++) progress(task, index);
  await act(async () => jest.advanceTimersByTime(1200));
  expect(mockSavedTasks.get(task.id).finishNum).toBe(20);
  expect(mockSavedTasks.has('other')).toBe(true);
  expect(mockWrites.length).toBe(1);
});

test('pausing saves the latest progress immediately before its normal timer', async () => {
  const task = await mountTask();
  progress(task, 7);
  await act(async () => current.pauseTask(task.id));
  expect(mockSavedTasks.get(task.id)).toMatchObject({
    status: 'pause',
    finishNum: 7,
  });
  expect(screen.getByText('pause:7')).toBeInTheDocument();
});

test('queued saves are immutable and cancelling cannot resurrect an older task', async () => {
  const task = await mountTask();
  let release;
  mockPendingWrite = new Promise((resolve) => {
    release = resolve;
  });
  progress(task, 1);
  await act(async () => jest.advanceTimersByTime(1200));
  expect(mockWrites).toHaveLength(1);
  task.finishList[0].status = 'is-success';
  progress(task, 2);
  await act(async () => current.pauseTask(task.id));
  expect(mockWrites[0][0].finishList[0].status).toBe('');
  expect(mockWrites).toHaveLength(1);
  let cancellation;
  act(() => {
    cancellation = current.cancelTask(task.id);
  });
  await act(async () => {
    mockPendingWrite = undefined;
    release();
    await cancellation;
  });
  expect(mockSavedTasks.has(task.id)).toBe(false);
});

test('late segment events from a cancelled task cannot recreate its persisted record', async () => {
  const task = await mountTask();
  await act(async () => current.cancelTask(task.id));
  progress(task, 1);
  await act(async () => jest.advanceTimersByTime(1200));
  expect(mockSavedTasks.has(task.id)).toBe(false);
});

test('restoring cached tasks keeps progress and replaces their old IDs exactly once in StrictMode', async () => {
  mockRestoredTasks = [
    {
      id: 'saved',
      url: 'https://test/video.m3u8',
      title: 'Restored video',
      type: 'TS',
      status: 'downloading',
      finishList: [{ title: 'segment', status: 'is-success' }],
      downloadIndex: 1,
      finishNum: 1,
      errorNum: 0,
      source: 'source',
      videoId: 'video',
      episodeIndex: 0,
      downloadMode: 'indexeddb',
      createdAt: 123,
      rangeDownload: {
        isShowRange: false,
        startSegment: 0,
        endSegment: 1,
        targetSegment: 1,
      },
      segmentLogs: [],
    },
  ];
  mockSavedTasks.set('saved', mockRestoredTasks[0]);
  await act(async () =>
    render(
      React.createElement(
        React.StrictMode,
        null,
        React.createElement(
          downloads.DownloadProvider,
          null,
          React.createElement(Progress)
        )
      )
    )
  );
  expect(current.tasks).toHaveLength(1);
  expect(current.tasks[0]).toMatchObject({
    status: 'pause',
    finishNum: 1,
    createdAt: 123,
  });
  expect(mockSavedTasks.has('saved')).toBe(false);
  expect([...mockSavedTasks.values()]).toHaveLength(1);
  expect([...mockSavedTasks.values()][0]).toMatchObject({
    status: 'pause',
    finishNum: 1,
  });
});

test('page exit flushes progress that is still waiting for the save timer', async () => {
  const task = await mountTask();
  progress(task, 3);
  await act(async () => window.dispatchEvent(new Event('pagehide')));
  expect(mockSavedTasks.get(task.id).finishNum).toBe(3);
});

test.each(['done', 'error'])(
  '%s is saved before the progress timer',
  async (status) => {
    const task = await mountTask();
    task.status = status;
    if (status === 'error')
      jest.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => {
      if (status === 'done') await current.downloader.options.onComplete(task);
      else current.downloader.options.onError(task, 'network error');
    });
    expect(mockSavedTasks.get(task.id).status).toBe(status);
  }
);

test('retrying failed segments immediately persists their restarted state', async () => {
  const task = await mountTask();
  task.status = 'pause';
  task.errorNum = 1;
  task.finishList[0].status = 'is-error';
  // Keep real retry transitions; only stop the outgoing network request.
  jest.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(() => {});
  await act(async () => current.retryFailedSegments(task.id));
  expect(mockSavedTasks.get(task.id)).toMatchObject({
    status: 'downloading',
    errorNum: 0,
  });
  expect(mockSavedTasks.get(task.id).finishList[0].status).toBe(
    'is-downloading'
  );
});

test('a slow restore does not temporarily save a duplicate alongside its original ID', async () => {
  const saved = {
    id: 'first',
    url: 'https://test/video.m3u8',
    title: 'Restored video',
    type: 'TS',
    status: 'pause',
    finishList: [{ title: 'segment', status: '' }],
    downloadIndex: 0,
    finishNum: 0,
    errorNum: 0,
    downloadMode: 'indexeddb',
    createdAt: 123,
    rangeDownload: {
      isShowRange: false,
      startSegment: 0,
      endSegment: 1,
      targetSegment: 1,
    },
    segmentLogs: [],
  };
  mockRestoredTasks = [saved, { ...saved, id: 'second' }];
  mockRestoredTasks.forEach((task) => mockSavedTasks.set(task.id, task));
  let finishSecond;
  M3U8Downloader.prototype.fetchM3U8
    .mockResolvedValueOnce('#EXTM3U\n#EXTINF:10,\nsegment.ts\n#EXT-X-ENDLIST')
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSecond = resolve;
        })
    );
  await act(async () =>
    render(
      React.createElement(
        downloads.DownloadProvider,
        null,
        React.createElement(Progress)
      )
    )
  );
  await act(async () => jest.advanceTimersByTime(1200));
  const countDuringRestore = mockSavedTasks.size;
  await act(async () =>
    finishSecond('#EXTM3U\n#EXTINF:10,\nsegment.ts\n#EXT-X-ENDLIST')
  );
  expect(countDuringRestore).toBe(2);
  expect(mockSavedTasks.size).toBe(2);
  expect(mockSavedTasks.has('first')).toBe(false);
});
