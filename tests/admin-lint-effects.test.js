const React = require('react');
const {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} = require('@testing-library/react');
const { AdminPanel } = require('../src/components/admin/AdminPanel');
const {
  MovieRequestsComponent,
} = require('../src/components/admin/MovieRequestsComponent');
const {
  OpenListConfigComponent,
} = require('../src/components/admin/OpenListConfigComponent');
const { confirmDiscardChanges } = require('../src/hooks/useUnsavedChanges');

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(window, 'confirm').mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function panel(version) {
  return React.createElement(
    AdminPanel,
    { version },
    React.createElement('input', { 'aria-label': '站点名称' }),
  );
}

test('an edit made immediately after opening a panel retains its unsaved navigation guard', () => {
  render(panel(1));
  fireEvent.change(screen.getByLabelText('站点名称'), {
    target: { value: '新的站点名称' },
  });

  act(() => jest.runOnlyPendingTimers());

  expect(screen.getByRole('status')).toBeInTheDocument();
  expect(confirmDiscardChanges()).toBe(false);
});

test('a new edit after a saved revision remains dirty when pending callbacks run', () => {
  const view = render(panel(1));
  act(() => jest.runOnlyPendingTimers());
  fireEvent.change(screen.getByLabelText('站点名称'), {
    target: { value: '已保存的名称' },
  });

  view.rerender(panel(2));
  fireEvent.change(screen.getByLabelText('站点名称'), {
    target: { value: '保存后继续编辑' },
  });
  act(() => jest.runOnlyPendingTimers());

  expect(screen.getByRole('status')).toBeInTheDocument();
  expect(confirmDiscardChanges()).toBe(false);
});

describe('admin list loading lifecycles', () => {
  const originalFetch = globalThis.fetch;
  let requests;

  beforeEach(() => {
    requests = [];
    globalThis.fetch = jest.fn(
      (url, options) =>
        new Promise((resolve) => {
          requests.push({ url, options, resolve });
        }),
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function respond(request, body, status = 200) {
    expect(request).toBeDefined();
    await act(async () => {
      request.resolve({ ok: status < 400, status, json: async () => body });
    });
  }

  const movie = {
    id: 'pending-movie',
    title: '待处理电影',
    status: 'pending',
    requestCount: 1,
    requestedBy: ['viewer'],
    createdAt: 1000,
  };
  const openListConfig = {
    ConfigVersion: 1,
    OpenListConfig: {
      Enabled: true,
      URL: 'https://openlist.example',
      Username: 'admin',
      Password: 'test-password',
      RootPaths: ['/'],
    },
  };
  const video = {
    id: 'video-1',
    title: '当前配置影片',
    folder: '/video-1',
    failed: false,
    mediaType: 'movie',
    releaseDate: '2026-01-01',
    voteAverage: 8,
  };
  const listUrl = '/api/openlist/list?page=1&pageSize=100&includeFailed=true';

  test('switching movie filters ignores the previous response and keeps the latest list', async () => {
    render(
      React.createElement(MovieRequestsComponent, {
        config: null,
        refreshConfig: async () => {},
      }),
    );
    expect(requests[0].url).toBe(
      '/api/movie-requests?status=pending&detail=true',
    );
    fireEvent.click(screen.getByRole('button', { name: /已上架 \(/ }));
    expect(requests[2].url).toBe(
      '/api/movie-requests?status=fulfilled&detail=true',
    );

    await respond(requests[2], {
      requests: [
        {
          ...movie,
          id: 'fulfilled-movie',
          title: '已上架电影',
          status: 'fulfilled',
        },
      ],
    });
    await respond(requests[0], { requests: [movie] });

    expect(screen.getByText('已上架电影')).toBeInTheDocument();
    expect(screen.queryByText('待处理电影')).not.toBeInTheDocument();
  });

  test.each([
    ['标记已上架', 'PATCH'],
    ['删除', 'DELETE'],
  ])(
    'movie action %s and filter changes show loading until the new list arrives',
    async (label, method) => {
      render(
        React.createElement(MovieRequestsComponent, {
          config: null,
          refreshConfig: async () => {},
        }),
      );
      expect(screen.queryByText('暂无求片')).not.toBeInTheDocument();
      await respond(requests[0], { requests: [movie] });
      await respond(requests[1], { requests: [movie] });

      fireEvent.click(screen.getByRole('button', { name: /待处理 \(/ }));
      expect(requests).toHaveLength(2);
      expect(screen.getByText('待处理电影')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(requests[2].options.method).toBe(method);
      await respond(requests[2], { success: true });
      expect(screen.queryByText('待处理电影')).not.toBeInTheDocument();
      expect(screen.queryByText('暂无求片')).not.toBeInTheDocument();
      await respond(requests[3], { requests: [] });
      await respond(requests[4], { requests: [] });
      expect(screen.getByText('暂无求片')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /已上架 \(/ }));
      expect(screen.queryByText('暂无求片')).not.toBeInTheDocument();
      await respond(requests[5], { requests: [] });
      expect(screen.getByText('暂无求片')).toBeInTheDocument();
    },
  );

  test('OpenList loading follows config readiness and ignores an older config response', async () => {
    const view = render(
      React.createElement(OpenListConfigComponent, {
        config: null,
        refreshConfig: async () => {},
      }),
    );
    expect(requests).toHaveLength(0);
    view.rerender(
      React.createElement(OpenListConfigComponent, {
        config: openListConfig,
        refreshConfig: async () => {},
      }),
    );
    expect(requests[0].url).toBe(listUrl);
    expect(screen.getByText('加载中...')).toBeInTheDocument();
    view.rerender(
      React.createElement(OpenListConfigComponent, {
        config: { ...openListConfig, ConfigVersion: 2 },
        refreshConfig: async () => {},
      }),
    );
    expect(requests[1].url).toBe(listUrl);
    await respond(requests[1], { list: [video] });
    await respond(requests[0], { list: [{ ...video, title: '旧配置影片' }] });

    expect(screen.getByText('当前配置影片')).toBeInTheDocument();
    expect(screen.queryByText('旧配置影片')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '立即扫描' })).toBeEnabled();
  });

  test('an automatic OpenList reload does not end a manual scan or its list reload', async () => {
    const view = render(
      React.createElement(OpenListConfigComponent, {
        config: openListConfig,
        refreshConfig: async () => {},
      }),
    );
    await respond(requests[0], { list: [video] });
    fireEvent.click(screen.getByRole('button', { name: '立即扫描' }));
    expect(requests[1].url).toBe('/api/openlist/refresh');
    await respond(requests[1], { taskId: 'scan-1' });
    view.rerender(
      React.createElement(OpenListConfigComponent, {
        config: { ...openListConfig, ConfigVersion: 2 },
        refreshConfig: async () => {},
      }),
    );
    await respond(requests[2], { list: [video] });
    expect(
      screen
        .getAllByRole('button', { name: '扫描中...' })
        .every((button) => button.disabled),
    ).toBe(true);

    await act(async () => jest.advanceTimersByTime(1000));
    expect(requests[3].url).toBe('/api/openlist/scan-progress?taskId=scan-1');
    await respond(requests[3], {
      task: { status: 'completed', result: { new: 1, existing: 0, errors: 0 } },
    });
    expect(requests[4].url).toBe(listUrl + '&noCache=true');
    expect(screen.getByText('加载中...')).toBeInTheDocument();
    await respond(requests[4], { list: [{ ...video, title: '扫描后的影片' }] });
    expect(screen.getByText('扫描后的影片')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '立即扫描' })).toBeEnabled();
  });

  test('a failed OpenList list request stops loading and permits scanning', async () => {
    render(
      React.createElement(OpenListConfigComponent, {
        config: openListConfig,
        refreshConfig: async () => {},
      }),
    );
    await respond(requests[0], { error: 'unavailable' }, 503);
    expect(screen.queryByText('加载中...')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '立即扫描' })).toBeEnabled();
  });
});
