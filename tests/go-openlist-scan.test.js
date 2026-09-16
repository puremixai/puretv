/** @jest-environment node */
require('./web-globals');
jest.mock('../src/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('../src/lib/db', () => ({
  db: {
    getGlobalValue: jest.fn(),
    setGlobalValue: jest.fn(),
    saveAdminConfig: jest.fn(),
  },
}));
jest.mock('../src/lib/openlist.client', () => ({ OpenListClient: jest.fn() }));
jest.mock('../src/lib/tmdb.search', () => ({
  searchTMDB: jest.fn(),
  getTVSeasonDetails: jest.fn(),
}));
const { getConfig } = require('../src/lib/config');
const { db } = require('../src/lib/db');
const { OpenListClient } = require('../src/lib/openlist.client');
const { searchTMDB } = require('../src/lib/tmdb.search');
const { startOpenListRefresh } = require('../src/lib/openlist-refresh');
const { getScanTask } = require('../src/lib/scan-task');
const originalFetch = global.fetch;
let config;
const folder = {
  name: 'Film 2024',
  is_dir: true,
  size: 0,
  modified: '2024-01-01',
  type: 1,
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.replaceProperty(process, 'env', {
    NODE_ENV: 'test',
    PURETV_GO_OPENLIST_SCAN: 'true',
    PURETV_GO_URL: 'http://worker:8081',
    PURETV_GO_TOKEN: 's'.repeat(32),
  });
  config = {
    SiteConfig: { TMDBApiKey: 'tmdb-secret' },
    OpenListConfig: {
      Enabled: true,
      URL: 'https://openlist.example',
      Username: 'account',
      Password: 'openlist-secret',
      RootPaths: ['/Movies'],
      ScanMode: 'name',
    },
  };
  getConfig.mockResolvedValue(config);
  db.getGlobalValue.mockResolvedValue(null);
  db.setGlobalValue.mockResolvedValue();
  db.saveAdminConfig.mockResolvedValue();
  searchTMDB.mockResolvedValue({
    code: 200,
    result: { id: 42, title: 'Matched title', media_type: 'movie' },
  });
  OpenListClient.mockImplementation(() => ({
    listDirectory: jest.fn(async () => ({
      code: 200,
      data: { content: [folder] },
    })),
  }));
  global.fetch = jest.fn(
    async () =>
      new Response(
        JSON.stringify({
          groups: [{ rootPath: '/Movies', folders: [folder] }],
          errors: [],
        }),
      ),
  );
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function completeScan() {
  const { taskId } = await startOpenListRefresh(false);
  for (
    let attempt = 0;
    attempt < 20 && getScanTask(taskId).status === 'running';
    attempt++
  )
    await jest.advanceTimersByTimeAsync(500);
  return getScanTask(taskId);
}
test('Go enumerates directories while the existing Node matching, persistence and task contract remain intact', async () => {
  const task = await completeScan();
  expect(task.status).toBe('completed');
  expect(task.result).toEqual({ total: 1, new: 1, existing: 0, errors: 0 });
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(OpenListClient).not.toHaveBeenCalled();
  const [url, init] = global.fetch.mock.calls[0];
  expect(url).toBe('http://worker:8081/v1/openlist/roots');
  expect(JSON.parse(init.body)).toEqual({
    url: config.OpenListConfig.URL,
    username: 'account',
    password: 'openlist-secret',
    rootPaths: ['/Movies'],
  });
  expect(new Headers(init.headers).get('authorization')).toBe(
    `Bearer ${'s'.repeat(32)}`,
  );
  expect(searchTMDB).toHaveBeenCalled();
  const [key, raw] = db.setGlobalValue.mock.calls[0];
  expect(key).toBe('video.metainfo');
  expect(Object.values(JSON.parse(raw).folders)[0]).toMatchObject({
    folderName: '/Movies/Film 2024',
    tmdb_id: 42,
    title: 'Matched title',
    failed: false,
  });
  expect(db.saveAdminConfig).toHaveBeenCalledWith(
    expect.objectContaining({
      OpenListConfig: expect.objectContaining({ ResourceCount: 1 }),
    }),
  );
});
test('disabled Go scan keeps the original Node directory client', async () => {
  delete process.env.PURETV_GO_OPENLIST_SCAN;
  const task = await completeScan();
  expect(task.status).toBe('completed');
  expect(global.fetch).not.toHaveBeenCalled();
  expect(OpenListClient).toHaveBeenCalledTimes(1);
});
test('Go failure marks the existing scan task failed without a second Node scan', async () => {
  global.fetch.mockRejectedValue(new Error('upstream secret'));
  const task = await completeScan();
  expect(task.status).toBe('failed');
  expect(task.error).not.toContain('secret');
  expect(db.setGlobalValue).not.toHaveBeenCalled();
  expect(OpenListClient).not.toHaveBeenCalled();
});
