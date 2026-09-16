/** @jest-environment node */
jest.mock('../src/lib/db', () => ({
  db: { getAdminConfig: jest.fn(), saveAdminConfig: jest.fn() },
}));
jest.mock('../src/lib/notification-dispatch', () => ({
  dispatchNotificationChannels: jest.fn(),
}));
jest.mock('../src/lib/user-cache', () => ({
  userInfoCache: { get: jest.fn(), set: jest.fn() },
}));
const { db } = require('../src/lib/db');
const { getConfig } = require('../src/lib/config');
const { PostgresStorage } = require('../src/lib/postgres.db');
test('configuration read errors do not initialize defaults and recovery is retryable', async () => {
  const original = process.env.NEXT_PUBLIC_STORAGE_TYPE;
  process.env.NEXT_PUBLIC_STORAGE_TYPE = 'postgres';
  try {
    db.getAdminConfig.mockRejectedValue(new Error('database offline'));
    await expect(getConfig(true)).rejects.toThrow('database offline');
    await expect(getConfig(true)).rejects.toThrow('database offline');
    expect(db.saveAdminConfig).not.toHaveBeenCalled();
    db.getAdminConfig.mockResolvedValue({
      ConfigFile: '',
      ConfigSubscriptions: [],
      SiteConfig: { SiteName: 'preserved' },
      UserConfig: { Users: [] },
      SourceConfig: [],
      CustomCategories: [],
      LiveConfig: [],
    });
    expect((await getConfig(true)).SiteConfig.SiteName).toBe('preserved');
    expect(db.saveAdminConfig).not.toHaveBeenCalled();
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_STORAGE_TYPE;
    else process.env.NEXT_PUBLIC_STORAGE_TYPE = original;
  }
});
test('storage distinguishes failed queries from missing rows', async () => {
  const failure = new Error('connection refused');
  const statement = {
    bind: jest.fn().mockReturnThis(),
    first: jest.fn().mockRejectedValue(failure),
    all: jest.fn().mockRejectedValue(failure),
    run: jest.fn().mockResolvedValue({ success: true }),
  };
  const storage = new PostgresStorage({ prepare: () => statement });
  await storage.schemaReady;
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    for (const read of [
      () => storage.getAdminConfig(),
      () => storage.getUserLocalSettings('user'),
      () => storage.getPlayRecord('user', 'key'),
      () => storage.getAllPlayRecords('user'),
      () => storage.getFavorite('user', 'key'),
      () => storage.getGlobalValue('key'),
    ])
      await expect(read()).rejects.toBe(failure);
    statement.first.mockResolvedValue(null);
    expect(await storage.getAdminConfig()).toBeNull();
    expect(await storage.getUserLocalSettings('user')).toBeNull();
  } finally {
    log.mockRestore();
  }
});
