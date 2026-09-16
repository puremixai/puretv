const { act, renderHook } = require('@testing-library/react');
const { useSavedAIComments } = require('../src/hooks/useSavedAIComments');
const nativeFetch = global.fetch;
const saved = {
  canGenerate: true,
  status: 'completed',
  comments: [{ id: '1', content: '持久评论', isAiGenerated: true }],
  total: 1,
  movieName: '电影',
  isAiGenerated: true,
};
const idle = { ...saved, status: 'idle', comments: [], total: 0 };
const queued = { ...idle, status: 'queued', jobId: 'task-1' };
const response = (body) => ({ ok: true, status: 200, json: async () => body });
const flush = () => act(async () => {});
beforeEach(() => {
  jest.useFakeTimers();
  global.fetch = jest.fn();
});
afterEach(() => {
  jest.useRealTimers();
  global.fetch = nativeFetch;
});

test('opening and reopening a movie loads saved comments without paid requests', async () => {
  global.fetch.mockResolvedValue(response(saved));
  let hook = renderHook(() => useSavedAIComments('电影', '2024'));
  await flush();
  expect(hook.result.current.job.comments).toEqual(saved.comments);
  expect(hook.result.current.restoring).toBe(false);
  hook.unmount();
  hook = renderHook(() => useSavedAIComments('电影', '2024'));
  await flush();
  expect(hook.result.current.job.comments).toEqual(saved.comments);
  expect(
    global.fetch.mock.calls.every((call) => call[1].method === 'GET')
  ).toBe(true);
  hook.unmount();
});

test('refresh during generation resumes polling the existing task without another POST', async () => {
  global.fetch
    .mockResolvedValueOnce(response(idle))
    .mockResolvedValueOnce(response(queued));
  let hook = renderHook(() => useSavedAIComments('电影', '2024'));
  await flush();
  await act(async () => {
    await hook.result.current.start();
  });
  expect(hook.result.current.loading).toBe(true);
  hook.unmount();
  global.fetch
    .mockResolvedValueOnce(response(queued))
    .mockResolvedValueOnce(response(saved));
  hook = renderHook(() => useSavedAIComments('电影', '2024'));
  await flush();
  expect(hook.result.current.job.jobId).toBe('task-1');
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(hook.result.current.job.comments).toEqual(saved.comments);
  expect(hook.result.current.loading).toBe(false);
  expect(
    global.fetch.mock.calls.filter((call) => call[1].method === 'POST')
  ).toHaveLength(1);
  hook.unmount();
});

test('a late response from the previous movie cannot overwrite the current movie', async () => {
  let resolveOld;
  global.fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      })
  );
  const hook = renderHook(({ name }) => useSavedAIComments(name), {
    initialProps: { name: '旧片' },
  });
  global.fetch.mockResolvedValueOnce(response({ ...saved, movieName: '新片' }));
  hook.rerender({ name: '新片' });
  await flush();
  await act(async () => {
    resolveOld(response({ ...saved, movieName: '旧片' }));
  });
  expect(hook.result.current.job.movieName).toBe('新片');
  hook.unmount();
});

test('slow polling does not launch overlapping requests', async () => {
  let resolveRead;
  global.fetch.mockResolvedValueOnce(response(queued)).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveRead = resolve;
      })
  );
  const hook = renderHook(() => useSavedAIComments('电影'));
  await flush();
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  await act(async () => {
    jest.advanceTimersByTime(10000);
  });
  expect(global.fetch).toHaveBeenCalledTimes(2);
  await act(async () => {
    resolveRead(response(saved));
  });
  expect(hook.result.current.loading).toBe(false);
  hook.unmount();
});

test('failed regeneration keeps previous comments visible', async () => {
  global.fetch
    .mockResolvedValueOnce(response(saved))
    .mockResolvedValueOnce(
      response({ ...saved, status: 'failed', error: 'AI调用失败' })
    );
  const hook = renderHook(() => useSavedAIComments('电影'));
  await flush();
  await act(async () => {
    await hook.result.current.regenerate();
  });
  expect(JSON.parse(global.fetch.mock.calls[1][1].body).regenerate).toBe(true);
  expect(hook.result.current.job.comments).toEqual(saved.comments);
  expect(hook.result.current.error).toBe('AI调用失败');
  hook.unmount();
});

test('uncertain submission is recovered by reading instead of paying for another generation', async () => {
  global.fetch
    .mockResolvedValueOnce(response(idle))
    .mockRejectedValueOnce(new Error('connection lost'))
    .mockResolvedValueOnce(response(saved));
  const hook = renderHook(() => useSavedAIComments('电影'));
  await flush();
  await act(async () => {
    await hook.result.current.start();
  });
  await act(async () => {
    jest.advanceTimersByTime(5000);
  });
  expect(hook.result.current.job.comments).toEqual(saved.comments);
  expect(
    global.fetch.mock.calls.filter((call) => call[1].method === 'POST')
  ).toHaveLength(1);
  hook.unmount();
});

test('read-only viewers cannot submit through hook actions', async () => {
  global.fetch.mockResolvedValue(response({ ...saved, canGenerate: false }));
  const hook = renderHook(() => useSavedAIComments('电影'));
  await flush();
  await act(async () => {
    await hook.result.current.start();
    await hook.result.current.regenerate();
  });
  expect(hook.result.current.canGenerate).toBe(false);
  expect(hook.result.current.job.comments).toEqual(saved.comments);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch.mock.calls[0][1].method).toBe('GET');
  hook.unmount();
});

test('revoked generation permission hides actions and blocks further submissions', async () => {
  global.fetch
    .mockResolvedValueOnce(response(saved))
    .mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: '仅管理员可以生成', canGenerate: false }),
    });
  const hook = renderHook(() => useSavedAIComments('电影'));
  await flush();
  await act(async () => {
    await hook.result.current.regenerate();
  });
  expect(hook.result.current.canGenerate).toBe(false);
  await act(async () => {
    await hook.result.current.start();
  });
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(hook.result.current.job.comments).toEqual(saved.comments);
  hook.unmount();
});
