/** @jest-environment node */
/* global afterEach, beforeEach, expect, jest, test */
import bs58 from 'bs58';

import { clearConfigCache, getConfig, refineConfig } from '../src/lib/config';
import { db } from '../src/lib/db';

jest.mock('../src/lib/db', () => ({
  db: {
    getAdminConfig: jest.fn(),
    saveAdminConfig: jest.fn(),
  },
}));

const importedLive = {
  name: 'Imported TV',
  url: 'https://example.com/iptv.m3u',
  ua: 'IPTV test client',
  epg: 'https://example.com/epg.xml',
};

const importFile = (lives) => JSON.stringify({ lives });

function configForImport(lives, existing = []) {
  return {
    ConfigFile: importFile(lives),
    SourceConfig: [],
    CustomCategories: [],
    LiveConfig: existing,
  };
}

beforeEach(async () => {
  // Keep local .env values out of both initialization and assertion output.
  jest.replaceProperty(process, 'env', {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    NEXT_PUBLIC_STORAGE_TYPE: 'localstorage',
    INIT_CONFIG: '',
    CONFIG_SUBSCRIPTION_URL: '',
  });
  jest
    .spyOn(global, 'fetch')
    .mockRejectedValue(new Error('Unexpected network request'));
  db.getAdminConfig.mockReset().mockResolvedValue(null);
  db.saveAdminConfig.mockReset().mockResolvedValue(undefined);
  await clearConfigCache();
});

afterEach(async () => {
  await clearConfigCache();
  jest.restoreAllMocks();
});

test('refineConfig imports a new live source with an explicit direct default', () => {
  const result = refineConfig(configForImport({ fresh: importedLive }));

  expect(result.LiveConfig).toEqual([
    {
      ...importedLive,
      key: 'fresh',
      from: 'config',
      disabled: false,
      channelNumber: 0,
      proxyMode: 'direct',
    },
  ]);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(db.getAdminConfig).not.toHaveBeenCalled();
  expect(db.saveAdminConfig).not.toHaveBeenCalled();
});

test.each(['full', 'm3u8-only'])(
  'refineConfig preserves an existing %s preference across import refreshes',
  (proxyMode) => {
    let current = configForImport({ existing: importedLive }, [
      {
        key: 'existing',
        name: 'Old title',
        url: 'https://example.com/old.m3u',
        from: 'config',
        disabled: true,
        channelNumber: 18,
        proxyMode,
      },
    ]);

    for (const name of ['Refreshed TV', 'Refreshed TV again']) {
      current.ConfigFile = importFile({
        existing: { ...importedLive, name },
        added: importedLive,
      });
      current = refineConfig(current);
      expect(
        current.LiveConfig.find((live) => live.key === 'existing'),
      ).toEqual({
        ...importedLive,
        key: 'existing',
        name,
        from: 'config',
        disabled: true,
        channelNumber: 18,
        proxyMode,
      });
      expect(
        current.LiveConfig.find((live) => live.key === 'added').proxyMode,
      ).toBe('direct');
    }
  },
);

test.each(['localstorage', 'postgres'])(
  'first getConfig initialization in %s imports INIT_CONFIG lives as direct',
  async (storageType) => {
    process.env.NEXT_PUBLIC_STORAGE_TYPE = storageType;
    process.env.INIT_CONFIG = importFile({ initial: importedLive });

    const result = await getConfig(true);

    expect(result.LiveConfig).toHaveLength(1);
    expect(result.LiveConfig[0]).toMatchObject({
      key: 'initial',
      url: importedLive.url,
      proxyMode: 'direct',
    });
    expect(global.fetch).not.toHaveBeenCalled();
    if (storageType === 'localstorage') {
      expect(db.getAdminConfig).not.toHaveBeenCalled();
      expect(db.saveAdminConfig).not.toHaveBeenCalled();
    } else {
      expect(db.getAdminConfig).toHaveBeenCalledTimes(1);
      expect(db.saveAdminConfig).toHaveBeenCalled();
      for (const [saved] of db.saveAdminConfig.mock.calls) {
        expect(saved.LiveConfig[0].proxyMode).toBe('direct');
      }
    }
  },
);

test('first getConfig initialization imports subscription lives as direct through the fetch boundary', async () => {
  process.env.CONFIG_SUBSCRIPTION_URL =
    'https://example.com/initial-config.txt';
  const encodedConfig = bs58.encode(
    Buffer.from(importFile({ subscribed: importedLive }), 'utf8'),
  );
  global.fetch.mockResolvedValueOnce({
    ok: true,
    text: async () => encodedConfig,
  });

  const result = await getConfig(true);

  expect(result.LiveConfig).toHaveLength(1);
  expect(result.LiveConfig[0]).toMatchObject({
    key: 'subscribed',
    url: importedLive.url,
    proxyMode: 'direct',
  });
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch).toHaveBeenCalledWith(
    'https://example.com/initial-config.txt',
  );
  expect(db.getAdminConfig).not.toHaveBeenCalled();
  expect(db.saveAdminConfig).not.toHaveBeenCalled();
});
