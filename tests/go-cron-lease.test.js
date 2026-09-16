/** @jest-environment node */
require('./web-globals');

jest.mock('../server/cron-auth', () => ({ isCronAuthorized: () => true }));
jest.mock('../src/lib/config', () => ({
  getConfig: jest.fn(),
  refineConfig: (value) => value,
}));
jest.mock('../src/lib/db', () => ({
  db: {
    getAllUsers: jest.fn(),
    getAllPlayRecords: jest.fn(),
    getAllFavorites: jest.fn(),
    getAllMangaShelf: jest.fn(),
    savePlayRecord: jest.fn(),
    saveFavorite: jest.fn(),
    saveMangaShelf: jest.fn(),
    deleteGlobalValue: jest.fn(),
  },
  getStorage: jest.fn(),
}));
jest.mock('../src/lib/server/go-jobs', () => ({
  acquireGoJob: jest.fn(),
  GoJobError: class GoJobError extends Error {
    constructor(status) {
      super('lease lost');
      this.status = status;
    }
  },
}));
jest.mock('../src/lib/anime-subscription', () => ({
  checkAnimeSubscriptions: jest.fn(async () => undefined),
}));
jest.mock('../src/lib/config-subscriptions', () => ({
  applySubscriptionConfig: (value) => value,
}));
jest.mock('../src/lib/server/config-subscriptions', () => ({
  refreshSubscriptions: jest.fn(),
}));
jest.mock('../src/lib/server/update-config', () => ({
  updateConfig: jest.fn(),
}));
jest.mock('../src/lib/server/source-health', () => ({
  refreshSourceHealth: jest.fn(async () => undefined),
}));
jest.mock('../src/lib/openlist-refresh', () => ({
  startOpenListRefresh: jest.fn(),
}));
jest.mock('../src/lib/fetchVideoDetail', () => ({
  fetchVideoDetail: jest.fn(),
}));
jest.mock('../src/lib/email.service', () => ({
  EmailService: { send: jest.fn() },
}));
jest.mock('../src/lib/email.templates', () => ({
  getBatchFavoriteUpdateEmailTemplate: () => '<mail/>',
  getBatchMangaUpdateEmailTemplate: () => '<mail/>',
}));
jest.mock('../src/lib/live', () => ({
  getLastGlobalLiveRefreshTime: () => 0,
  getLiveRefreshIntervalHours: () => 12,
  refreshLiveChannels: jest.fn(),
  setLastGlobalLiveRefreshTime: jest.fn(),
}));
jest.mock('../src/lib/logger', () => ({
  logger: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));
jest.mock('../src/lib/suwayomi.client', () => ({
  SuwayomiClient: jest.fn(),
  getSuwayomiConfig: jest.fn(),
  loginWithSimpleAuth: jest.fn(),
}));

const originalWait = process.env.CRON_WAIT_FOR_COMPLETION;
const originalUsername = process.env.USERNAME;
let fixture;
beforeEach(() => {
  jest.resetModules();
  process.env.CRON_WAIT_FOR_COMPLETION = 'true';
  process.env.USERNAME = 'fixture-viewer';
  const config = {
    SiteConfig: { SiteName: 'Fixture' },
    EmailConfig: { enabled: true },
    LiveConfig: [],
    SourceConfig: [],
    ConfigSubscriptions: [],
  };
  const { db, getStorage } = require('../src/lib/db');
  const { acquireGoJob, GoJobError } = require('../src/lib/server/go-jobs');
  const { EmailService } = require('../src/lib/email.service');
  const storage = {
    addNotification: jest.fn(async () => undefined),
    getUserEmail: jest.fn(async () => 'fixture@example.test'),
    getEmailNotificationPreference: jest.fn(async () => true),
  };
  const lease = {
    assertActive: jest.fn(() => {
      if (fixture.expired) throw new GoJobError(409);
    }),
    finish: jest.fn(async () => undefined),
  };
  fixture = { db, storage, lease, expired: false, send: EmailService.send };
  require('../src/lib/config').getConfig.mockResolvedValue(config);
  require('../src/lib/server/update-config').updateConfig.mockImplementation(
    async (mutator) => mutator(config),
  );
  acquireGoJob.mockResolvedValue(lease);
  getStorage.mockReturnValue(storage);
  db.getAllUsers.mockResolvedValue(['fixture-viewer']);
  db.getAllPlayRecords.mockResolvedValue({});
  db.getAllFavorites.mockResolvedValue({});
  db.getAllMangaShelf.mockResolvedValue({});
  EmailService.send.mockResolvedValue(undefined);
  require('../src/lib/suwayomi.client').SuwayomiClient.mockImplementation(
    () => ({
      getMangaDetail: jest.fn(async () => ({
        chapters: [
          { id: '1', chapterNumber: 1 },
          { id: '2', chapterNumber: 2 },
        ],
        title: 'Manga',
      })),
    }),
  );
  fixture.run = () => {
    const { NextRequest } = require('next/server');
    return require('../src/app/api/cron/[password]/route').GET(
      new NextRequest('https://app.example/api/cron/fixture'),
      { params: Promise.resolve({ password: 'fixture' }) },
    );
  };
});
afterEach(() => {
  if (originalWait === undefined) delete process.env.CRON_WAIT_FOR_COMPLETION;
  else process.env.CRON_WAIT_FOR_COMPLETION = originalWait;
  if (originalUsername === undefined) delete process.env.USERNAME;
  else process.env.USERNAME = originalUsername;
});

function withUpdate(kind) {
  if (kind === 'favorite') {
    fixture.db.getAllFavorites.mockResolvedValue({
      'cms+1': { title: 'Show', total_episodes: 1 },
    });
    require('../src/lib/fetchVideoDetail').fetchVideoDetail.mockResolvedValue({
      title: 'Show',
      episodes: ['one', 'two'],
    });
  } else {
    fixture.db.getAllMangaShelf.mockResolvedValue({
      'source+1': {
        sourceId: 'source',
        mangaId: '1',
        title: 'Manga',
        latestChapterId: '1',
        latestChapterCount: 1,
      },
    });
  }
}

test('lost lease between favorite save and notification prevents notification and email', async () => {
  withUpdate('favorite');
  fixture.db.saveFavorite.mockImplementation(async () => {
    fixture.expired = true;
  });
  const response = await fixture.run();
  expect(response.status).toBe(429);
  expect(fixture.storage.addNotification).not.toHaveBeenCalled();
  expect(fixture.send).not.toHaveBeenCalled();
  expect(fixture.lease.finish).toHaveBeenCalledWith(false);
});

test('lost lease after manga lookup prevents notification and email', async () => {
  withUpdate('manga');
  require('../src/lib/suwayomi.client').SuwayomiClient.mockImplementation(
    () => ({
      getMangaDetail: jest.fn(async () => {
        fixture.expired = true;
        return {
          chapters: [
            { id: '1', chapterNumber: 1 },
            { id: '2', chapterNumber: 2 },
          ],
        };
      }),
    }),
  );
  expect((await fixture.run()).status).toBe(429);
  expect(fixture.storage.addNotification).not.toHaveBeenCalled();
  expect(fixture.send).not.toHaveBeenCalled();
});

test.each(['favorite', 'manga'])(
  'lost lease during %s email preferences lookup prevents sending',
  async (kind) => {
    withUpdate(kind);
    fixture.storage.getUserEmail.mockImplementation(async () => {
      fixture.expired = true;
      return 'fixture@example.test';
    });
    expect((await fixture.run()).status).toBe(429);
    expect(fixture.storage.addNotification).toHaveBeenCalledTimes(1);
    expect(fixture.send).not.toHaveBeenCalled();
    expect(fixture.lease.finish).toHaveBeenCalledWith(false);
  },
);

test.each(['favorite', 'manga'])(
  'cron holds lease until pending %s email completes',
  async (kind) => {
    withUpdate(kind);
    let releaseMail;
    let mailStarted;
    const entered = new Promise((resolve) => {
      mailStarted = resolve;
    });
    const pendingMail = new Promise((resolve) => {
      releaseMail = resolve;
    });
    fixture.send.mockImplementation(() => {
      mailStarted();
      return pendingMail;
    });
    const running = fixture.run();
    await entered;
    // Let the other cron branches settle: a detached email would release the lease.
    await new Promise((resolve) => setImmediate(resolve));
    expect(fixture.lease.finish).not.toHaveBeenCalled();
    releaseMail();
    expect((await running).status).toBe(200);
    expect(fixture.lease.finish).toHaveBeenCalledWith(true);
  },
);
