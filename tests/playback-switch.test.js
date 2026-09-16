const {
  createPlaybackSwitchCoordinator,
  createEpisodeSwitchPlan,
  findNextPlayableEpisode,
  buildPlaybackSelectionUrl,
} = require('../src/components/player/playback-switch');

test('episode selection updates the URL consumed by room synchronization and preserves other parameters', () => {
  const next = new URL(
    buildPlaybackSelectionUrl(
      'https://puretv.example/play?source=a&id=film&episode=2&room=room-1#player',
      { episodeIndex: 2 },
    ),
  );
  expect(next.searchParams.get('episode')).toBe('3');
  expect(next.searchParams.get('source')).toBe('a');
  expect(next.searchParams.get('room')).toBe('room-1');
  expect(next.hash).toBe('#player');
});

test('source selection puts the chosen source and fallback episode in one URL update', () => {
  const next = new URL(
    buildPlaybackSelectionUrl(
      'https://puretv.example/play?source=a&id=old&episode=9&stitle=original',
      { source: 'b', id: 'new', title: '电影', year: '2026', episodeIndex: 0 },
    ),
  );
  expect(Object.fromEntries(next.searchParams)).toEqual({
    source: 'b',
    id: 'new',
    episode: '1',
    title: '电影',
    year: '2026',
    stitle: 'original',
  });
});

const movie = (source, count = 3) => ({
  source,
  id: 'film',
  title: 'Film',
  year: '2026',
  poster: '/cover.png',
  source_name: source,
  episodes: Array.from({ length: count }, (_, i) => `${i}`),
});
const request = (source, overrides = {}) => ({
  target: { source, id: 'film', title: 'Film' },
  previous: {
    source: 'a',
    id: 'film',
    episodeIndex: 1,
    currentTime: 123.5,
    duration: 1800,
    contentKey: 'film',
    episodeCount: 3,
    title: 'Film',
  },
  searchTitle: 'Film',
  ...overrides,
});
function ports(overrides = {}) {
  return {
    loadDetail: async (target) => movie(target.source),
    contentKey: () => 'film',
    presentation: (detail) => ({
      detail,
      title: detail.title,
      cover: detail.poster,
      description: '',
    }),
    loadLocal: jest.fn(() => 55),
    readRecord: jest.fn(async () => null),
    commit: jest.fn(),
    transferSkip: jest.fn(async () => {}),
    saveLocal: jest.fn(),
    migrate: jest.fn(async () => {}),
    clearDanmaku: jest.fn(async () => {}),
    onError: jest.fn(),
    onPersistenceError: jest.fn(),
    ...overrides,
  };
}

test('episode switching restores only the selected local episode', () => {
  const load = jest.fn((key, index) => (index === 2 ? 77 : null));
  expect(
    createEpisodeSwitchPlan(
      {
        currentIndex: 1,
        targetIndex: 2,
        totalEpisodes: 3,
        contentKey: 'film',
        hasSource: true,
      },
      load,
    ),
  ).toEqual({ episodeIndex: 2, resumeTime: 77 });
  expect(load).toHaveBeenCalledWith('film', 2);
  expect(
    createEpisodeSwitchPlan(
      {
        currentIndex: 1,
        targetIndex: 1,
        totalEpisodes: 3,
        contentKey: 'film',
        hasSource: true,
      },
      load,
    ),
  ).toBeNull();
  expect(
    createEpisodeSwitchPlan(
      {
        currentIndex: 1,
        targetIndex: 3,
        totalEpisodes: 3,
        contentKey: 'film',
        hasSource: true,
      },
      load,
    ),
  ).toBeNull();
});

test('episode switching saves the departed episode before committing the restored position', () => {
  const events = [];
  const coordinator = createPlaybackSwitchCoordinator();
  coordinator.switchEpisode(
    {
      currentIndex: 0,
      targetIndex: 1,
      totalEpisodes: 2,
      contentKey: 'film',
      hasSource: true,
    },
    {
      loadLocal: () => 77,
      saveDeparting: () => events.push('saved episode 0'),
      commit: (plan) =>
        events.push(`episode ${plan.episodeIndex} at ${plan.resumeTime}`),
    },
  );
  expect(events).toEqual(['saved episode 0', 'episode 1 at 77']);
});

test('next episode selection skips filtered titles without changing previous-episode behavior', () => {
  expect(
    findNextPlayableEpisode(
      0,
      4,
      ['one', 'skip', 'skip', 'four'],
      (title) => title === 'skip',
    ),
  ).toBe(3);
  expect(
    findNextPlayableEpisode(
      0,
      3,
      ['one', 'skip', 'skip'],
      (title) => title === 'skip',
    ),
  ).toBeNull();
});

test('same-episode source switching retains fractional seek position and migrates a whole-second record', async () => {
  const adapter = ports();
  await createPlaybackSwitchCoordinator().switchSource(request('b'), adapter);
  expect(adapter.commit.mock.calls[0][0]).toMatchObject({
    episodeIndex: 1,
    resumeTime: 123.5,
    sameEpisode: true,
  });
  expect(adapter.readRecord).not.toHaveBeenCalled();
  expect(adapter.migrate.mock.calls[0][0]).toMatchObject({
    from: { source: 'a', id: 'film' },
    to: { source: 'b', id: 'film' },
    record: { index: 2, play_time: 123, total_time: 1800 },
  });
});

test('a source with fewer episodes restores episode zero locally instead of carrying a different episode time', async () => {
  const adapter = ports({ loadDetail: async () => movie('b', 1) });
  await createPlaybackSwitchCoordinator().switchSource(request('b'), adapter);
  expect(adapter.commit.mock.calls[0][0]).toMatchObject({
    episodeIndex: 0,
    resumeTime: 55,
    sameEpisode: false,
  });
  expect(adapter.readRecord).not.toHaveBeenCalled();
  expect(adapter.migrate).not.toHaveBeenCalled();
  expect(adapter.clearDanmaku).toHaveBeenCalledWith('Film');
});

test('same-episode switching falls back to the captured previous source record, then local progress', async () => {
  const input = request('b');
  input.previous.currentTime = 0;
  const adapter = ports({
    readRecord: jest.fn(async () => ({ index: 2, play_time: 91 })),
  });
  await createPlaybackSwitchCoordinator().switchSource(input, adapter);
  expect(adapter.readRecord).toHaveBeenCalledWith({ source: 'a', id: 'film' });
  expect(adapter.commit.mock.calls[0][0].resumeTime).toBe(91);
  adapter.readRecord.mockRejectedValue(new Error('offline'));
  await createPlaybackSwitchCoordinator().switchSource(input, adapter);
  expect(adapter.commit.mock.calls[1][0].resumeTime).toBe(55);
});

test('a late old detail response cannot replace a newer source or migrate its records', async () => {
  let release;
  const coordinator = createPlaybackSwitchCoordinator();
  const adapter = ports({
    loadDetail: (target) =>
      target.source === 'b'
        ? new Promise((resolve) => {
            release = resolve;
          })
        : Promise.resolve(movie('c')),
  });
  const old = coordinator.switchSource(request('b'), adapter);
  await coordinator.switchSource(request('c'), adapter);
  release(movie('b'));
  await old;
  expect(adapter.commit).toHaveBeenCalledTimes(1);
  expect(adapter.commit.mock.calls[0][0].detail.source).toBe('c');
  expect(adapter.migrate).toHaveBeenCalledTimes(1);
});

test('a late resume lookup cannot overwrite the latest selected source', async () => {
  let release;
  const coordinator = createPlaybackSwitchCoordinator();
  const adapter = ports({
    readRecord: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const input = request('b');
  input.previous.currentTime = 0;
  const old = coordinator.switchSource(input, adapter);
  await Promise.resolve();
  await coordinator.switchSource(request('c'), adapter);
  release({ index: 2, play_time: 91 });
  await old;
  expect(adapter.commit).toHaveBeenCalledTimes(1);
  expect(adapter.commit.mock.calls[0][0].detail.source).toBe('c');
});

test('source migration waits for every already captured progress save', async () => {
  const {
    createProgressSaver,
  } = require('../src/components/player/playback-progress');
  let release;
  const writes = [];
  const coordinator = createPlaybackSwitchCoordinator();
  const saver = createProgressSaver({
    enqueue: (operation) => coordinator.enqueuePersistence(operation),
    saveLocal: () => {},
    persist: async (value) => {
      if (value.record.play_time === 35)
        await new Promise((resolve) => {
          release = resolve;
        });
      writes.push(`save ${value.record.play_time}`);
    },
  });
  const value = (time) => ({
    source: 'a',
    id: 'film',
    episodeIndex: 1,
    record: { play_time: time, total_time: 1800 },
  });
  const first = saver.save(value(35));
  await Promise.resolve();
  const second = saver.save(value(60));
  const switching = coordinator.switchSource(
    request('b'),
    ports({
      migrate: async () => {
        writes.push('migrate a to b');
      },
    }),
  );
  for (let i = 0; i < 10; i++) await Promise.resolve();
  release();
  await Promise.all([first, second, switching]);
  expect(writes).toEqual(['save 35', 'save 60', 'migrate a to b']);
});

test('episode selection cancels an outstanding source record lookup, including its late error', async () => {
  let reject;
  const coordinator = createPlaybackSwitchCoordinator();
  const adapter = ports({
    loadDetail: () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  });
  const pending = coordinator.switchSource(request('b'), adapter);
  coordinator.cancel();
  reject(new Error('old failure'));
  await pending;
  expect(adapter.commit).not.toHaveBeenCalled();
  expect(adapter.onError).not.toHaveBeenCalled();
});

test('source migrations follow committed selections even when the first persistence is delayed', async () => {
  let release;
  const migrations = [];
  const coordinator = createPlaybackSwitchCoordinator();
  const adapter = ports({
    migrate: async ({ to }) => {
      if (to.source === 'b')
        await new Promise((resolve) => {
          release = resolve;
        });
      migrations.push(to.source);
    },
  });
  const first = coordinator.switchSource(request('b'), adapter);
  for (let i = 0; i < 10 && !release; i++) await Promise.resolve();
  const second = coordinator.switchSource(
    request('c', { previous: { ...request('b').previous, source: 'b' } }),
    adapter,
  );
  for (let i = 0; i < 10 && adapter.commit.mock.calls.length < 2; i++)
    await Promise.resolve();
  expect(adapter.commit).toHaveBeenCalledTimes(2);
  release();
  await Promise.all([first, second]);
  expect(migrations).toEqual(['b', 'c']);
});
