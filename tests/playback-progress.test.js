const { act, renderHook } = require('@testing-library/react');
const {
  createProgressSnapshot,
  createPlaybackProgressGuard,
  createProgressSaver,
} = require('../src/components/player/playback-progress');
const {
  usePlaybackProgress,
} = require('../src/components/player/usePlaybackProgress');

function snapshot(overrides = {}) {
  return createProgressSnapshot(
    {
      source: 'a',
      id: 'film',
      contentKey: 'film-2026',
      episodeIndex: 0,
      title: 'Film',
      searchTitle: 'Film',
      currentTime: 35.9,
      duration: 1800,
      detail: {
        source_name: 'Source A',
        year: '2026',
        poster: '/cover.png',
        episodes: ['1', '2'],
      },
      ...overrides,
    },
    1000,
  );
}

test('switching to another episode cannot save the previous player time under the new identity', () => {
  const guard = createPlaybackProgressGuard();
  guard.resume(guard.revision());
  expect(guard.canCapture()).toBe(true);
  guard.suspend();
  expect(guard.canCapture()).toBe(false);
  expect(
    guard.sourcePosition({ currentTime: 900, duration: 1800 }, 77),
  ).toEqual({ currentTime: 77, duration: 0 });
  guard.resume(guard.revision());
  expect(guard.canCapture()).toBe(true);
  expect(
    guard.sourcePosition({ currentTime: 78, duration: 1500 }, null),
  ).toEqual({ currentTime: 78, duration: 1500 });
});

test('a late ready ticket cannot reopen sampling after another selection or failed source attempt', () => {
  const guard = createPlaybackProgressGuard();
  const previousMedia = guard.revision();
  guard.resume(previousMedia);
  guard.suspend();
  expect(guard.resume(previousMedia)).toBe(false);
  expect(guard.canCapture()).toBe(false);
  expect(guard.resume(guard.revision())).toBe(true);
});

test('exit during a source fallback keeps the departed checkpoint instead of writing old time into episode zero', async () => {
  const guard = createPlaybackProgressGuard();
  guard.resume(guard.revision());
  let current = snapshot({ episodeIndex: 5, currentTime: 900 });
  const local = [];
  const { result, unmount } = renderHook(() =>
    usePlaybackProgress({
      capture: () => (guard.canCapture() ? current : null),
      saveLocal: (value) =>
        local.push([value.record.index, value.record.play_time]),
      persist: async () => {},
    }),
  );
  await act(async () => {
    await result.current();
  });
  guard.suspend();
  current = snapshot({ source: 'b', episodeIndex: 0, currentTime: 900 });
  await act(async () => {
    window.dispatchEvent(new Event('beforeunload'));
  });
  expect(local).toEqual([[6, 900]]);
  unmount();
});

test('a progress snapshot captures the selected episode and does not retain mutable detail state', () => {
  const detail = {
    source_name: 'A',
    year: '2026',
    poster: '/a.png',
    episodes: ['1', '2'],
  };
  const saved = snapshot({ detail, episodeIndex: 1 });
  detail.poster = '/changed.png';
  expect(saved.record).toMatchObject({
    index: 2,
    play_time: 35,
    total_time: 1800,
    cover: '/a.png',
    save_time: 1000,
  });
});

test.each([
  { currentTime: 0 },
  { currentTime: NaN },
  { duration: Infinity },
  { duration: 0 },
  { source: '' },
])('invalid progress does not produce a storage write: %j', (values) => {
  expect(snapshot(values)).toBeNull();
});

test('equal seconds on different episodes and sources are saved independently', async () => {
  const saved = [];
  const saver = createProgressSaver({
    saveLocal: () => {},
    persist: async (value) => {
      saved.push(value);
    },
  });
  await saver.save(snapshot());
  await saver.save(snapshot());
  await saver.save(snapshot({ episodeIndex: 1 }));
  await saver.save(snapshot({ source: 'b', episodeIndex: 1 }));
  expect(saved.map((value) => [value.source, value.record.index])).toEqual([
    ['a', 1],
    ['a', 2],
    ['b', 2],
  ]);
});

test('local exit progress is saved immediately while remote saves complete in capture order', async () => {
  let finishFirst;
  const local = [];
  const remote = [];
  const saver = createProgressSaver({
    saveLocal: (value) => local.push(value.record.play_time),
    persist: async (value) => {
      if (value.record.play_time === 35)
        await new Promise((resolve) => {
          finishFirst = resolve;
        });
      remote.push(value.record.play_time);
    },
  });
  const first = saver.save(snapshot());
  await Promise.resolve();
  const exit = saver.save(snapshot({ currentTime: 42 }));
  expect(local).toEqual([35, 42]);
  expect(remote).toEqual([]);
  finishFirst();
  await Promise.all([first, exit]);
  expect(remote).toEqual([35, 42]);
});

test('a failed remote save can retry and does not block a newer snapshot', async () => {
  const persist = jest
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(undefined);
  const saver = createProgressSaver({ saveLocal: () => {}, persist });
  await expect(saver.save(snapshot())).rejects.toThrow('offline');
  await saver.save(snapshot());
  await saver.save(snapshot({ currentTime: 50 }));
  expect(persist).toHaveBeenCalledTimes(3);
});

test('seeking back to an in-flight position still writes after a newer queued position', async () => {
  let release;
  const remote = [];
  const saver = createProgressSaver({
    saveLocal: () => {},
    persist: async (value) => {
      if (!remote.length)
        await new Promise((resolve) => {
          release = resolve;
        });
      remote.push(value.record.play_time);
    },
  });
  const first = saver.save(snapshot());
  await Promise.resolve();
  const second = saver.save(snapshot({ currentTime: 60 }));
  const seekBack = saver.save(snapshot());
  release();
  await Promise.all([first, second, seekBack]);
  expect(remote).toEqual([35, 60, 35]);
});

test('a client-side navigation captures progress when the hook unmounts', async () => {
  const local = jest.fn();
  const persist = jest.fn(async () => {});
  const { unmount } = renderHook(() =>
    usePlaybackProgress({ capture: snapshot, saveLocal: local, persist }),
  );
  unmount();
  expect(local).toHaveBeenCalledTimes(1);
  await act(async () => {});
  expect(persist).toHaveBeenCalledTimes(1);
});

test('exit snapshots progress before destroying the player and handlers use the latest rendered selection', async () => {
  let player = { currentTime: 10, duration: 1800 };
  const local = [];
  const persist = jest.fn(async () => {});
  const onExit = jest.fn(() => {
    player = null;
  });
  const { rerender, unmount } = renderHook(
    ({ episodeIndex }) =>
      usePlaybackProgress({
        capture: () => (player ? snapshot({ ...player, episodeIndex }) : null),
        saveLocal: (value) => local.push(value.record.index),
        persist,
        onExit,
      }),
    { initialProps: { episodeIndex: 0 } },
  );
  rerender({ episodeIndex: 1 });
  await act(async () => {
    window.dispatchEvent(new Event('beforeunload'));
  });
  expect(local).toEqual([2]);
  expect(onExit).toHaveBeenCalledTimes(1);
  expect(persist.mock.calls[0][0].record.index).toBe(2);
  unmount();
  window.dispatchEvent(new Event('beforeunload'));
  expect(onExit).toHaveBeenCalledTimes(1);
});

test('hiding the page saves and releases wake lock; showing it restores wake lock', async () => {
  const persist = jest.fn(async () => {});
  const onHidden = jest.fn();
  const onVisible = jest.fn();
  const { unmount } = renderHook(() =>
    usePlaybackProgress({
      capture: snapshot,
      saveLocal: () => {},
      persist,
      onHidden,
      onVisible,
    }),
  );
  const visibility = jest.spyOn(document, 'visibilityState', 'get');
  visibility.mockReturnValue('hidden');
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(persist).toHaveBeenCalledTimes(1);
  expect(onHidden).toHaveBeenCalledTimes(1);
  visibility.mockReturnValue('visible');
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(onVisible).toHaveBeenCalledTimes(1);
  unmount();
  visibility.mockRestore();
});
