const React = require('react');
const {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} = require('@testing-library/react');

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
// Keep the store implementation; expose replaceable read boundaries for delayed IO.
jest.mock('@/lib/db.client', () => ({
  ...jest.requireActual('@/lib/db.client'),
}));

const AcgSearch = require('../src/components/AcgSearch').default;
const PansouSearch = require('../src/components/PansouSearch').default;
const { useSavedAIComments } = require('../src/hooks/useSavedAIComments');
const AddToPlaylistModal =
  require('../src/components/AddToPlaylistModal').default;
const DanmakuFilterSettings =
  require('../src/components/DanmakuFilterSettings').default;
const EpisodeFilterSettings =
  require('../src/components/EpisodeFilterSettings').default;
const {
  DownloadManagementPanel,
} = require('../src/components/DownloadManagementPanel');
const configStore = require('../src/lib/db.client');
const { downloadDB } = require('../src/lib/download-db');
const nativeFetch = global.fetch;
const response = (body) => ({ ok: true, status: 200, json: async () => body });
const flushTimers = () => act(async () => jest.advanceTimersByTime(1));

beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  global.fetch = jest.fn(async () =>
    response({ total: 0, items: [], results: [] }),
  );
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  global.fetch = nativeFetch;
  jest.restoreAllMocks();
});

function deferredRead() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const filterCases = [
  [
    'danmaku',
    DanmakuFilterSettings,
    'getDanmakuFilterConfig',
    'saveDanmakuFilterConfig',
  ],
  [
    'episodes',
    EpisodeFilterSettings,
    'getEpisodeFilterConfig',
    'saveEpisodeFilterConfig',
  ],
];
const filterConfig = (keyword) => ({
  reverseMode: false,
  rules: [{ id: keyword, keyword, type: 'normal', enabled: true }],
});
const playlistResponse = (name) =>
  response({
    data: {
      playlists: [
        {
          id: name,
          name,
          username: 'tester',
          created_at: 1,
          updated_at: 1,
        },
      ],
    },
  });

test.each(filterCases)(
  '%s keeps the new opening pending when an old read settles first',
  async (_name, Component, readMethod) => {
    jest.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const oldRead = deferredRead();
    const newRead = deferredRead();
    jest
      .spyOn(configStore, readMethod)
      .mockReturnValueOnce(oldRead.promise)
      .mockReturnValueOnce(newRead.promise);
    const props = { isOpen: true, onClose: jest.fn() };
    const view = render(React.createElement(Component, props));
    view.rerender(React.createElement(Component, { ...props, isOpen: false }));
    view.rerender(React.createElement(Component, props));
    await act(async () => oldRead.reject(new Error('old read failed')));
    expect(screen.getByText('加载中...')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '保存', exact: true }),
    ).toBeDisabled();
    await act(async () => newRead.resolve(null));
    expect(screen.getByText('暂无屏蔽规则')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '保存', exact: true }),
    ).toBeEnabled();
  },
);

test('creating a playlist starts one fresh read and displays its result', async () => {
  const refreshed = deferredRead();
  global.fetch
    .mockResolvedValueOnce(playlistResponse('原歌单'))
    .mockResolvedValueOnce(response({ data: { id: 'new' } }))
    .mockReturnValueOnce(refreshed.promise);
  render(
    React.createElement(AddToPlaylistModal, {
      isOpen: true,
      song: null,
      onClose: jest.fn(),
    }),
  );
  await act(async () => {});
  expect(screen.getByText('原歌单')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '创建新歌单' }));
  fireEvent.change(screen.getByPlaceholderText('歌单名称'), {
    target: { value: '创建的歌单' },
  });
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: '确定' })),
  );
  expect(
    global.fetch.mock.calls.map(([, options]) => options?.method || 'GET'),
  ).toEqual(['GET', 'POST', 'GET']);
  expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({
    name: '创建的歌单',
    description: '',
  });
  expect(screen.queryByText('原歌单')).not.toBeInTheDocument();
  await act(async () => refreshed.resolve(playlistResponse('创建的歌单')));
  expect(screen.getByText('创建的歌单')).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(3);
});

test('closing the playlist modal aborts its pending read', () => {
  global.fetch.mockImplementation(() => new Promise(() => {}));
  const props = { isOpen: true, song: null, onClose: jest.fn() };
  const view = render(React.createElement(AddToPlaylistModal, props));
  const signal = global.fetch.mock.calls[0][1].signal;
  expect(signal.aborted).toBe(false);
  view.rerender(
    React.createElement(AddToPlaylistModal, { ...props, isOpen: false }),
  );
  expect(signal.aborted).toBe(true);
  view.rerender(React.createElement(AddToPlaylistModal, props));
  const nextSignal = global.fetch.mock.calls[1][1].signal;
  expect(nextSignal.aborted).toBe(false);
  view.unmount();
  expect(nextSignal.aborted).toBe(true);
});

test.each(filterCases)(
  '%s cannot save an unread config and enables editing after the read completes',
  async (_name, Component, readMethod, saveMethod) => {
    jest.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const pending = deferredRead();
    const read = jest
      .spyOn(configStore, readMethod)
      .mockReturnValue(pending.promise);
    const save = jest
      .spyOn(configStore, saveMethod)
      .mockResolvedValue(undefined);
    const props = {
      isOpen: false,
      onClose: jest.fn(),
      onConfigUpdate: jest.fn(),
    };
    const view = render(React.createElement(Component, props));
    expect(read).not.toHaveBeenCalled();
    view.rerender(React.createElement(Component, { ...props, isOpen: true }));
    expect(read).toHaveBeenCalledTimes(1);
    expect(screen.getByText('加载中...')).toBeInTheDocument();
    const saveButton = screen.getByRole('button', {
      name: '保存',
      exact: true,
    });
    expect(saveButton).toBeDisabled();
    fireEvent.click(saveButton);
    expect(save).not.toHaveBeenCalled();
    await act(async () => pending.resolve(filterConfig('已存规则')));
    expect(screen.getByText('已存规则')).toBeInTheDocument();
    expect(saveButton).toBeEnabled();
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '新增规则' },
    });
    fireEvent.click(screen.getByRole('button', { name: '添加', exact: true }));
    await act(async () => fireEvent.click(saveButton));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].rules.map((rule) => rule.keyword)).toEqual([
      '已存规则',
      '新增规则',
    ]);
    expect(
      props.onConfigUpdate.mock.calls[0][0].rules.map((rule) => rule.keyword),
    ).toEqual(['已存规则', '新增规则']);
  },
);

test.each(filterCases)(
  '%s ignores a previous opening response and retains the exit animation',
  async (_name, Component, readMethod) => {
    jest.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const oldRead = deferredRead();
    const newRead = deferredRead();
    const read = jest
      .spyOn(configStore, readMethod)
      .mockReturnValueOnce(oldRead.promise)
      .mockReturnValueOnce(newRead.promise);
    const props = { isOpen: true, onClose: jest.fn() };
    const view = render(React.createElement(Component, props));
    view.rerender(React.createElement(Component, { ...props, isOpen: false }));
    view.rerender(React.createElement(Component, props));
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => newRead.resolve(filterConfig('最新规则')));
    await act(async () => oldRead.resolve(filterConfig('过期规则')));
    expect(screen.queryByText('过期规则')).not.toBeInTheDocument();
    expect(screen.getByText('最新规则')).toBeInTheDocument();
    view.rerender(React.createElement(Component, { ...props, isOpen: false }));
    expect(screen.getByText('最新规则')).toBeInTheDocument();
    act(() => jest.advanceTimersByTime(300));
    expect(screen.queryByText('最新规则')).not.toBeInTheDocument();
  },
);

test('playlist reads start on open and an older response cannot replace the reopened list', async () => {
  const oldRead = deferredRead();
  const newRead = deferredRead();
  global.fetch
    .mockReturnValueOnce(oldRead.promise)
    .mockReturnValueOnce(newRead.promise);
  const props = { isOpen: false, song: null, onClose: jest.fn() };
  const view = render(React.createElement(AddToPlaylistModal, props));
  expect(global.fetch).not.toHaveBeenCalled();
  view.rerender(
    React.createElement(AddToPlaylistModal, { ...props, isOpen: true }),
  );
  expect(global.fetch).toHaveBeenCalledTimes(1);
  view.rerender(React.createElement(AddToPlaylistModal, props));
  view.rerender(
    React.createElement(AddToPlaylistModal, { ...props, isOpen: true }),
  );
  expect(global.fetch).toHaveBeenCalledTimes(2);
  await act(async () => newRead.resolve(playlistResponse('最新歌单')));
  await act(async () => oldRead.resolve(playlistResponse('过期歌单')));
  expect(screen.queryByText('过期歌单')).not.toBeInTheDocument();
  expect(screen.getByText('最新歌单')).toBeInTheDocument();
});

test('download reads start on open and an older response cannot replace the reopened list', async () => {
  const oldRead = deferredRead();
  const newRead = deferredRead();
  const read = jest
    .spyOn(downloadDB, 'getCompletedTasks')
    .mockReturnValueOnce(oldRead.promise)
    .mockReturnValueOnce(newRead.promise);
  const task = (title) => ({
    id: title,
    title,
    videoTitle: title,
    source: 'test',
    videoId: title,
    episodeIndex: 0,
    completedAt: 1,
    downloadMode: 'browser',
  });
  const props = { isOpen: false, onClose: jest.fn() };
  const view = render(React.createElement(DownloadManagementPanel, props));
  expect(read).not.toHaveBeenCalled();
  view.rerender(
    React.createElement(DownloadManagementPanel, { ...props, isOpen: true }),
  );
  expect(read).toHaveBeenCalledTimes(1);
  view.rerender(React.createElement(DownloadManagementPanel, props));
  view.rerender(
    React.createElement(DownloadManagementPanel, { ...props, isOpen: true }),
  );
  expect(read).toHaveBeenCalledTimes(2);
  await act(async () => newRead.resolve([task('最新下载')]));
  await act(async () => oldRead.resolve([task('过期下载')]));
  expect(screen.queryByText('过期下载')).not.toBeInTheDocument();
  expect(screen.getByText('最新下载')).toBeInTheDocument();
});

test.each([
  ['ACG', AcgSearch],
  ['Pansou', PansouSearch],
])(
  '%s preserves submit-only searching when the keyword or error callback changes',
  async (_name, Component) => {
    const props = {
      keyword: 'first',
      triggerSearch: false,
      cloudTypes: ['quark'],
    };
    const view = render(React.createElement(Component, props));
    await flushTimers();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    view.rerender(
      React.createElement(Component, {
        ...props,
        keyword: 'second',
        onError: jest.fn(),
      }),
    );
    await flushTimers();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    view.rerender(
      React.createElement(Component, {
        ...props,
        keyword: 'second',
        triggerSearch: true,
      }),
    );
    await flushTimers();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(global.fetch.mock.calls[1][1].body).keyword).toBe(
      'second',
    );
  },
);

test('Pansou without cloud filters does not resubmit after its own state updates', async () => {
  render(
    React.createElement(PansouSearch, {
      keyword: 'film',
      triggerSearch: false,
    }),
  );
  await flushTimers();
  await flushTimers();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('changing movie revokes the previous generation permission before another action', async () => {
  global.fetch
    .mockResolvedValueOnce(
      response({
        canGenerate: true,
        status: 'completed',
        comments: [],
        total: 0,
        movieName: 'first',
        isAiGenerated: true,
      }),
    )
    .mockImplementation(() => new Promise(() => {}));
  const hook = renderHook(({ name }) => useSavedAIComments(name), {
    initialProps: { name: 'first' },
  });
  await flushTimers();
  expect(hook.result.current.canGenerate).toBe(true);
  const oldSignal = global.fetch.mock.calls[0][1].signal;

  hook.rerender({ name: 'second' });
  expect(oldSignal.aborted).toBe(true);
  expect(hook.result.current.job.movieName).toBe('second');
  expect(hook.result.current.canGenerate).toBe(false);
  expect(hook.result.current.restoring).toBe(true);
  await act(async () => {
    await hook.result.current.start();
  });
  expect(global.fetch.mock.calls.map(([, options]) => options.method)).toEqual([
    'GET',
    'GET',
  ]);
  const pendingSignal = global.fetch.mock.calls[1][1].signal;
  hook.unmount();
  expect(pendingSignal.aborted).toBe(true);
});
