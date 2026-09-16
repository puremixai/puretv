/* global afterEach, beforeEach, expect, jest, test */
require('./web-globals');
const React = require('react');
const { act, cleanup, fireEvent, render, screen, waitFor } = require('@testing-library/react');

const mockPlayers = [];
const mockRouter = { replace: jest.fn() };
const mockSearchParams = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => mockSearchParams,
}));
jest.mock('../src/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }) => children,
}));
jest.mock('../src/components/EpgScrollableRow', () => ({ __esModule: true, default: () => null }));
jest.mock('../src/components/WatchRoomProvider', () => ({ useWatchRoomContextSafe: () => null }));
jest.mock('../src/lib/db.client', () => ({
  deleteFavorite: jest.fn(), saveFavorite: jest.fn(), savePlayRecord: jest.fn(),
  generateStorageKey: (source, id) => `${source}+${id}`,
  isFavorited: jest.fn(async () => false),
  isLivePlayRecordSavingEnabled: () => false,
  subscribeToDataUpdates: () => () => {},
}));
// Observe the real page's final engine options at the external-library boundary.
// The page and live-playback resolver execute unchanged.
jest.mock('artplayer', () => ({
  __esModule: true,
  default: class {
    constructor(option) {
      this.option = option;
      this.video = document.createElement('video');
      option.container.appendChild(this.video);
      this.on = jest.fn();
      this.off = jest.fn();
      this.destroy = jest.fn(() => this.video.remove());
      mockPlayers.push(this);
    }
  },
}));
jest.mock('hls.js', () => ({
  __esModule: true,
  default: class { static DefaultConfig = { loader: class {} }; },
}));
jest.mock('flv.js', () => ({ __esModule: true, default: { isSupported: () => true } }));
const LivePage = require('../src/app/live/page').default;

const originalFetch = global.fetch;
let requests;
let unexpectedRequests;
let consoleError;

beforeEach(() => {
  jest.useFakeTimers();
  mockPlayers.length = 0;
  mockRouter.replace.mockClear();
  localStorage.clear();
  requests = [];
  unexpectedRequests = [];
  jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: jest.fn() });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
  global.fetch = originalFetch;
  expect(unexpectedRequests).toEqual([]);
  expect(consoleError).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function mountChannels(urls, { mode, probe, sample } = {}) {
  const source = { key: 'news', name: 'News source', url: 'https://cdn.example/channels.m3u' };
  if (mode !== undefined) source.proxyMode = mode;
  const channels = urls.map((url, index) => ({
    id: `channel-${index}`, name: `Channel ${index + 1}`, tvgId: `channel-${index}`,
    group: 'News', logo: '', url,
  }));
  global.fetch = jest.fn((input, options) => {
    const url = String(input);
    requests.push({ url, options });
    if (url === '/api/live/sources') return Promise.resolve({ ok: true, json: async () => ({ success: true, data: [source] }) });
    if (url.startsWith('/api/live/channels?')) return Promise.resolve({ ok: true, json: async () => ({ success: true, data: channels }) });
    if (url.startsWith('/api/live/epg?')) return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { programs: [] } }) });
    if (url.startsWith('/api/live/precheck?') && probe) return probe.promise;
    if (sample && url === urls[0]) return Promise.resolve(new Response(new Uint8Array(1024)));
    unexpectedRequests.push(url);
    return Promise.reject(new Error(`Actual network is forbidden: ${url}`));
  });
  const view = render(React.createElement(LivePage));
  // The production page waits one second before revealing its player container.
  await act(async () => { await jest.advanceTimersByTimeAsync(0); });
  await act(async () => { await jest.advanceTimersByTimeAsync(1100); });
  return view;
}

test.each([
  ['https://cdn.example/live.m3u8?sig=a%2Fb%26c', 'm3u8'],
  ['https://cdn.example/live.mp4?next=playlist.m3u8&sig=a%2Fb', 'mp4'],
  ['https://cdn.example/live.flv?sig=a%2Fb', 'flv'],
])('Web defaults to the unchanged URL and correct engine for %s', async (url, type) => {
  await mountChannels([url]);
  await waitFor(() => expect(mockPlayers).toHaveLength(1));
  expect(mockPlayers[0].option).toMatchObject({ url, type });
  expect(requests.some(({ url: requested }) => /precheck|\/api\/proxy\//.test(requested))).toBe(false);
});

test.each(['full', 'm3u8-only'])('Web retains explicit %s at the initial Artplayer URL', async (mode) => {
  const raw = 'https://cdn.example/live.m3u8?sig=a%2Fb%26c';
  await mountChannels([raw], { mode });
  await waitFor(() => expect(mockPlayers).toHaveLength(1));
  const url = new URL(mockPlayers[0].option.url, 'https://puretv.example');
  expect(url.pathname).toBe('/api/proxy/m3u8');
  expect(url.searchParams.get('url')).toBe(raw);
  expect(url.searchParams.get('puretv-source')).toBe('news');
  expect(url.searchParams.get('allowCORS')).toBe(mode === 'm3u8-only' ? 'true' : null);
  expect(mockPlayers[0].option.type).toBe('m3u8');
});

test('a delayed format probe cannot create the previous channel after switching', async () => {
  const probe = deferred();
  const nextUrl = 'https://cdn.example/next.mp4?sig=keep%2Fme';
  const view = await mountChannels(['https://cdn.example/channel?id=old', nextUrl], { probe });
  const probeRequest = requests.find(({ url }) => url.startsWith('/api/live/precheck?'));
  expect(probeRequest).toBeDefined();
  expect(mockPlayers).toHaveLength(0);
  fireEvent.click(view.container.querySelector('[data-channel-id="channel-1"]'));
  await waitFor(() => expect(mockPlayers).toHaveLength(1));
  expect(mockPlayers[0].option.url).toBe(nextUrl);
  expect(probeRequest.options.signal.aborted).toBe(true);
  // A fetch implementation may deliver a response despite a late abort.
  await act(async () => { probe.resolve({ ok: true, json: async () => ({ success: true, type: 'm3u8' }) }); });
  expect(mockPlayers).toHaveLength(1);
  expect(mockPlayers[0].option.url).toBe(nextUrl);
});

test('a delayed format probe cannot recreate a player after unmount', async () => {
  const probe = deferred();
  const view = await mountChannels(['https://cdn.example/channel?id=old'], { probe });
  const probeRequest = requests.find(({ url }) => url.startsWith('/api/live/precheck?'));
  expect(probeRequest).toBeDefined();
  expect(mockPlayers).toHaveLength(0);
  view.unmount();
  expect(probeRequest.options.signal.aborted).toBe(true);
  await act(async () => { probe.resolve({ ok: true, json: async () => ({ success: true, type: 'm3u8' }) }); });
  expect(mockPlayers).toHaveLength(0);
});

test('Web speed testing samples an MP4 directly even when its query contains m3u8', async () => {
  const url = 'https://cdn.example/live.mp4?next=playlist.m3u8&sig=a%2Fb';
  await mountChannels([url], { sample: true });
  await waitFor(() => expect(mockPlayers).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: '测速' }));
  await waitFor(() => expect(requests.filter(({ url: requested }) => requested === url)).toHaveLength(1));
  await act(async () => { await jest.advanceTimersByTimeAsync(0); });
  expect(requests.some(({ url: requested }) => /precheck|\/api\/proxy\//.test(requested))).toBe(false);
  expect(screen.queryByText('不可用')).not.toBeInTheDocument();
});
