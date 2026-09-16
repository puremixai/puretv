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
jest.mock('../src/lib/server/go-jobs', () => ({ acquireGoJob: jest.fn() }));
jest.mock('../src/lib/server/go-worker', () => ({
  isGoWorkerEnabled: () => true,
  scanGoOpenListRoots: jest.fn(),
}));
jest.mock('../src/lib/tmdb.search', () => ({
  searchTMDB: jest.fn(),
  getTVSeasonDetails: jest.fn(),
}));
const { getConfig } = require('../src/lib/config');
const { db } = require('../src/lib/db');
const { acquireGoJob } = require('../src/lib/server/go-jobs');
const { scanGoOpenListRoots } = require('../src/lib/server/go-worker');
const { searchTMDB } = require('../src/lib/tmdb.search');
const { startOpenListRefresh } = require('../src/lib/openlist-refresh');
const { getScanTask } = require('../src/lib/scan-task');
let config, lease;
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  config = {
    SiteConfig: { TMDBApiKey: 'fixture' },
    OpenListConfig: {
      Enabled: true,
      URL: 'http://fixture.invalid',
      Username: 'user',
      Password: 'password',
      RootPaths: ['/Movies'],
      ScanMode: 'name',
    },
  };
  getConfig.mockResolvedValue(config);
  db.getGlobalValue.mockResolvedValue(null);
  lease = {
    id: 'lease-fixture',
    assertActive: jest.fn(),
    renew: jest.fn(async () => lease.assertActive()),
    finish: jest.fn(async () => {}),
  };
  acquireGoJob.mockResolvedValue(lease);
  scanGoOpenListRoots.mockResolvedValue({
    groups: [
      {
        rootPath: '/Movies',
        folders: [{ name: 'Example 2024', is_dir: true }],
      },
    ],
    errors: [],
  });
  searchTMDB.mockResolvedValue({
    code: 200,
    result: { id: 1, title: 'Example', media_type: 'movie' },
  });
});
afterEach(() => jest.useRealTimers());
test('changed config while acquiring lease rejects before migration or scanning', async () => {
  getConfig
    .mockResolvedValueOnce(config)
    .mockResolvedValueOnce({
      ...config,
      OpenListConfig: {
        ...config.OpenListConfig,
        URL: 'http://changed.invalid',
      },
    });
  await expect(startOpenListRefresh()).rejects.toThrow('扫描配置已变更');
  expect(scanGoOpenListRoots).not.toHaveBeenCalled();
  expect(db.setGlobalValue).not.toHaveBeenCalled();
  expect(lease.finish).toHaveBeenCalledWith(false);
});
test('expired lease during migration prevents both metadata and config writes', async () => {
  delete config.OpenListConfig.RootPaths;
  config.OpenListConfig.RootPath = '/Movies';
  db.getGlobalValue.mockImplementation(async () => {
    lease.assertActive.mockImplementation(() => {
      throw new Error('lease expired');
    });
    return '{"folders":{}}';
  });
  await expect(startOpenListRefresh()).rejects.toThrow('lease expired');
  expect(db.setGlobalValue).not.toHaveBeenCalled();
  expect(db.saveAdminConfig).not.toHaveBeenCalled();
});
test('lost lease while matching prevents final DB commit and marks scan failed', async () => {
  searchTMDB.mockImplementation(async () => {
    lease.assertActive.mockImplementation(() => {
      throw new Error('lease expired');
    });
    return {
      code: 200,
      result: { id: 1, title: 'Example', media_type: 'movie' },
    };
  });
  const { taskId } = await startOpenListRefresh();
  await jest.advanceTimersByTimeAsync(1000);
  expect(getScanTask(taskId).status).toBe('failed');
  expect(db.setGlobalValue).not.toHaveBeenCalled();
  expect(db.saveAdminConfig).not.toHaveBeenCalled();
  expect(lease.finish).toHaveBeenCalledWith(
    false,
    expect.objectContaining({ status: 'failed' }),
  );
});
