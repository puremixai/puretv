/** @jest-environment node */
require('./web-globals');

const { NextRequest } = require('next/server');

jest.mock('../src/lib/session', () => ({ getAuthenticatedUser: jest.fn() }));
jest.mock('../src/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('../src/lib/db', () => ({
  getStorage: jest.fn(),
  db: {
    getUsernameByTvboxToken: jest.fn(),
    getUserInfoV2: jest.fn(),
  },
}));
jest.mock('../src/lib/permissions', () => ({
  hasFeaturePermission: jest.fn(),
}));
jest.mock('../src/lib/openlist.client', () => ({ OpenListClient: jest.fn() }));
jest.mock('../src/lib/emby-manager', () => ({
  embyManager: { getClient: jest.fn(), clearCache: jest.fn() },
}));
jest.mock('../src/lib/bangumi.server', () => ({
  fetchBangumiFromServer: jest.fn(),
}));

const { getAuthenticatedUser } = require('../src/lib/session');
const { getConfig } = require('../src/lib/config');
const { getStorage, db } = require('../src/lib/db');
const { embyManager } = require('../src/lib/emby-manager');
const { fetchBangumiFromServer } = require('../src/lib/bangumi.server');
const movieRoutes = require('../src/app/api/movie-requests/[id]/route');
const {
  GET: openListPlay,
} = require('../src/app/api/openlist/play/[token]/route');
const {
  GET: embySubtitle,
} = require('../src/app/api/emby/subtitle/[token]/[filename]/route');
const {
  GET: bangumiSubject,
} = require('../src/app/api/bangumi/v0/subjects/[id]/route');

const originalToken = process.env.TVBOX_SUBSCRIBE_TOKEN;
const originalSiteBase = process.env.SITE_BASE;
const originalFetch = global.fetch;
let requests;
let notifications;
let userRequests;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.TVBOX_SUBSCRIBE_TOKEN = 'media-token';
  process.env.SITE_BASE = 'https://puretv.test';
  getAuthenticatedUser.mockResolvedValue({ username: 'owner', role: 'owner' });
  db.getUsernameByTvboxToken.mockResolvedValue(null);
  requests = new Map([
    [
      'movie-42',
      {
        id: 'movie-42',
        title: 'Test Movie',
        status: 'pending',
        requestedBy: ['alice'],
      },
    ],
  ]);
  notifications = [];
  userRequests = new Map([['alice', new Set(['movie-42'])]]);
  getStorage.mockReturnValue({
    getMovieRequest: async (id) => requests.get(id),
    getUserInfoV2: async () => ({ role: 'owner' }),
    updateMovieRequest: async (id, updates) =>
      Object.assign(requests.get(id), updates),
    addNotification: async (username, notification) =>
      notifications.push({ username, ...notification }),
    deleteMovieRequest: async (id) => requests.delete(id),
    removeUserMovieRequest: async (username, id) =>
      userRequests.get(username).delete(id),
  });
});

afterAll(() => {
  if (originalToken === undefined) delete process.env.TVBOX_SUBSCRIBE_TOKEN;
  else process.env.TVBOX_SUBSCRIBE_TOKEN = originalToken;
  if (originalSiteBase === undefined) delete process.env.SITE_BASE;
  else process.env.SITE_BASE = originalSiteBase;
  global.fetch = originalFetch;
});

const movieContext = () => ({ params: Promise.resolve({ id: 'movie-42' }) });
const movieRequest = (method, body) =>
  new NextRequest('https://puretv.test/api/movie-requests/movie-42', {
    method,
    ...(body
      ? {
          body: JSON.stringify(body),
          headers: { 'Content-Type': 'application/json' },
        }
      : {}),
  });

test('reads the movie selected by an asynchronous route ID', async () => {
  const response = await movieRoutes.GET(movieRequest('GET'), movieContext());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    request: { id: 'movie-42', title: 'Test Movie' },
  });
});

test('fulfills the selected movie and links requester notifications to its asynchronous ID', async () => {
  const response = await movieRoutes.PATCH(
    movieRequest('PATCH', {
      status: 'fulfilled',
      fulfilledSource: 'source-a',
      fulfilledId: 'video-7',
    }),
    movieContext()
  );
  expect(response.status).toBe(200);
  expect(requests.get('movie-42')).toMatchObject({
    status: 'fulfilled',
    fulfilledId: 'video-7',
  });
  expect(notifications).toEqual([
    expect.objectContaining({
      username: 'alice',
      metadata: { requestId: 'movie-42', source: 'source-a', id: 'video-7' },
    }),
  ]);
});

test('deletes the movie and user references selected by an asynchronous route ID', async () => {
  const response = await movieRoutes.DELETE(
    movieRequest('DELETE'),
    movieContext()
  );
  expect(response.status).toBe(200);
  expect(requests.has('movie-42')).toBe(false);
  expect([...userRequests.get('alice')]).toEqual([]);
});

test('preserves token authorization and the token in an OpenList proxy redirect', async () => {
  getAuthenticatedUser.mockResolvedValue(null);
  getConfig.mockResolvedValue({
    OpenListConfig: {
      Enabled: true,
      URL: 'https://openlist.test',
      Username: 'reader',
      Password: 'test-password',
      PathMeta: {
        movies: {
          category: '',
          refresh14m: false,
          proxyPlay: true,
          proxyCacheMinutes: 60,
        },
      },
    },
  });
  const response = await openListPlay(
    new NextRequest(
      'https://puretv.test/api/openlist/play/media-token?folder=movies&fileName=clip.mp4'
    ),
    { params: Promise.resolve({ token: 'media-token' }) }
  );
  expect(response.status).toBe(307);
  expect(response.headers.get('location')).toBe(
    'https://puretv.test/api/openlist/proxy/media-token/video.mp4?folder=movies&fileName=clip.mp4'
  );
});

test('streams subtitles using both the asynchronous token and filename format', async () => {
  getAuthenticatedUser.mockResolvedValue(null);
  getConfig.mockResolvedValue({ EmbyConfig: { Sources: [{ Key: 'test' }] } });
  embyManager.getClient.mockResolvedValue({
    getUserAgent: () => 'PureTV test',
    getSubtitleStreamUrl: async (item, source, index, format) =>
      `https://emby.test/${item}/${source}/${index}/subtitle.${format}`,
  });
  global.fetch = jest.fn(
    async (url) =>
      new Response(
        url === 'https://emby.test/item-1/source-1/2/subtitle.ass'
          ? '[Script Info]'
          : 'wrong subtitle',
        { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
      )
  );
  const response = await embySubtitle(
    new NextRequest(
      'https://puretv.test/api/emby/subtitle/media-token/subtitle.ass?itemId=item-1&mediaSourceId=source-1&streamIndex=2'
    ),
    {
      params: Promise.resolve({
        token: 'media-token',
        filename: 'subtitle.ass',
      }),
    }
  );
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('[Script Info]');
  expect(response.headers.get('cache-control')).toBe('private, max-age=3600');
});

test('rejects an invalid asynchronous media token without fetching a subtitle', async () => {
  getAuthenticatedUser.mockResolvedValue(null);
  global.fetch = jest.fn();
  const response = await embySubtitle(
    new NextRequest(
      'https://puretv.test/api/emby/subtitle/invalid/subtitle.ass?itemId=item-1&mediaSourceId=source-1&streamIndex=2'
    ),
    { params: Promise.resolve({ token: 'invalid', filename: 'subtitle.ass' }) }
  );
  expect(response.status).toBe(401);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('fetches the Bangumi subject selected by an asynchronous numeric ID', async () => {
  getConfig.mockResolvedValue({ SiteConfig: {} });
  fetchBangumiFromServer.mockImplementation(
    async (url) =>
      new Response(
        JSON.stringify(
          url === '/v0/subjects/123'
            ? { id: 123, name: 'Test subject' }
            : { error: 'wrong subject' }
        )
      )
  );
  const response = await bangumiSubject(
    new NextRequest('https://puretv.test/api/bangumi/v0/subjects/123'),
    {
      params: Promise.resolve({ id: '123' }),
    }
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ id: 123, name: 'Test subject' });
});

test('rejects a malformed asynchronous Bangumi ID before calling the upstream', async () => {
  const response = await bangumiSubject(
    new NextRequest('https://puretv.test/api/bangumi/v0/subjects/not-an-id'),
    {
      params: Promise.resolve({ id: 'not-an-id' }),
    }
  );
  expect(response.status).toBe(400);
  expect(fetchBangumiFromServer).not.toHaveBeenCalled();
});
