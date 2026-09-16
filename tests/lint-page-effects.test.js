const React = require('react');
const {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
  waitFor,
} = require('@testing-library/react');
const mockRouter = { replace: jest.fn(), back: jest.fn() };
let mockSearchParams = new URLSearchParams();
let mockScreenRoom;
const mockLeaveRoom = jest.fn();
const mockWebPlayers = [];
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => mockSearchParams,
}));
jest.mock('../src/lib/auth', () => {
  const actual = jest.requireActual('../src/lib/auth');
  return {
    ...actual,
    getAuthInfoFromBrowserCookie: jest.fn(actual.getAuthInfoFromBrowserCookie),
  };
});
// The TV shell owns global remote navigation; these tests exercise page state.
jest.mock('../src/components/tv/TVLayout', () => ({
  __esModule: true,
  default: ({ children }) => React.createElement('main', null, children),
}));
const TVMePage = require('../src/app/tv/me/page').default;
const auth = require('../src/lib/auth');
jest.mock('../src/lib/db.client', () => ({
  getAllPlayRecords: async () => ({}),
  getSkipConfig: async () => null,
  isFavorited: async () => false,
  savePlayRecord: async () => undefined,
}));
jest.mock('../src/components/tv/player/TVNativeVideo', () => ({
  __esModule: true,
  default: ({ url }) =>
    React.createElement('video', { src: url, 'data-testid': 'playback' }),
}));
jest.mock('../src/components/tv/TVVirtualRemote', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../src/lib/danmaku/api', () => ({
  ...jest.requireActual('../src/lib/danmaku/api'),
  // This page-state test does not have an IndexedDB media cache.
  initDanmakuModule: () => undefined,
}));
jest.mock('../src/components/WatchRoomProvider', () => ({
  useWatchRoomContext: () => ({
    currentRoom: mockScreenRoom,
    members: [],
    leaveRoom: mockLeaveRoom,
  }),
}));
jest.mock('../src/hooks/useScreenShare', () => ({
  screenShareQualityOptions: [
    { value: 'smooth', label: '流畅' },
    { value: 'hd', label: '高清' },
  ],
  useScreenShare: () => ({
    currentRoom: mockScreenRoom,
    isOwner: true,
    isSharing: false,
    isStarting: false,
    localVideoRef: { current: null },
    remoteVideoRef: { current: null },
  }),
}));
jest.mock('../src/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }) => children,
}));
jest.mock('../src/components/ProxyImage', () => ({
  __esModule: true,
  default: ({ originalSrc, alt }) =>
    React.createElement('img', { src: originalSrc, alt }),
}));
jest.mock('../src/hooks/useWebLiveSync', () => ({
  useWebLiveSync: () => ({}),
}));
jest.mock('artplayer', () => ({
  __esModule: true,
  default: class {
    constructor(options) {
      this.video = document.createElement('video');
      options.container.appendChild(this.video);
      this.off = () => undefined;
      this.destroy = () => this.video.remove();
      mockWebPlayers.push(options);
    }
  },
}));
jest.mock('hls.js', () => ({ __esModule: true, default: class {} }));
jest.mock('flv.js', () => ({ __esModule: true, default: {} }));
const TVPlayPage = require('../src/app/tv/play/page').default;
const TVLoginPage = require('../src/app/tv/login/page').default;
const WatchRoomScreenPage =
  require('../src/app/watch-room/screen/page').default;
const WebLivePage = require('../src/app/web-live/page').default;
const originalFetch = global.fetch;

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  jest
    .spyOn(HTMLMediaElement.prototype, 'pause')
    .mockImplementation(() => undefined);
  jest
    .spyOn(HTMLMediaElement.prototype, 'load')
    .mockImplementation(() => undefined);
  mockWebPlayers.length = 0;
  mockSearchParams = new URLSearchParams();
  mockRouter.replace.mockClear();
  auth.getAuthInfoFromBrowserCookie.mockImplementation(
    jest.requireActual('../src/lib/auth').getAuthInfoFromBrowserCookie,
  );
  localStorage.clear();
  sessionStorage.clear();
  document.cookie = `auth_info=${encodeURIComponent(JSON.stringify({ username: 'viewer', role: 'user' }))}; path=/`;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
  global.fetch = originalFetch;
  delete window.RUNTIME_CONFIG;
  document.cookie = 'auth_info=; path=/; max-age=0';
});

test('TV account page reads a valid cookie without an unstable snapshot render loop', () => {
  render(React.createElement(TVMePage));
  expect(screen.getByRole('heading', { name: 'viewer' })).toBeInTheDocument();
});

test('TV remote preference updates its selected option immediately after a click', () => {
  // Isolate the preference regression from the independent cookie snapshot loop.
  const currentAuth = auth.getAuthInfoFromBrowserCookie();
  auth.getAuthInfoFromBrowserCookie.mockReturnValue(currentAuth);
  render(React.createElement(TVMePage));
  fireEvent.click(screen.getByRole('button', { name: '音量控制' }));
  expect(localStorage.getItem('tv_player_up_down_action')).toBe('volume');
  expect(screen.getAllByText('音量控制')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: '唤醒菜单' }));
  expect(localStorage.getItem('tv_player_up_down_action')).toBe('wake-menu');
  expect(screen.getAllByText('唤醒菜单')).toHaveLength(2);
});

test('unrelated TV playback URL changes preserve the selected episode without reloading detail', async () => {
  mockSearchParams = new URLSearchParams('source=demo&id=video&index=0');
  const detail = {
    source: 'demo',
    id: 'video',
    title: 'Test series',
    poster: '',
    episodes: ['https://example.com/one.mp4', 'https://example.com/two.mp4'],
    episodes_titles: ['Episode 1', 'Episode 2'],
  };
  global.fetch = jest.fn(async (url) => ({
    ok: true,
    json: async () =>
      String(url).startsWith('/api/source-detail') ? detail : { results: [] },
  }));
  const view = render(React.createElement(TVPlayPage));
  await waitFor(() =>
    expect(screen.getByTestId('playback')).toHaveAttribute(
      'src',
      'https://example.com/one.mp4',
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: '下一集' }));
  await waitFor(() =>
    expect(screen.getByTestId('playback')).toHaveAttribute(
      'src',
      'https://example.com/two.mp4',
    ),
  );
  mockSearchParams = new URLSearchParams(
    'source=demo&id=video&index=0&panel=info',
  );
  await act(async () => view.rerender(React.createElement(TVPlayPage)));
  expect(screen.getByTestId('playback')).toHaveAttribute(
    'src',
    'https://example.com/two.mp4',
  );
  expect(
    global.fetch.mock.calls.filter(([url]) =>
      String(url).startsWith('/api/source-detail'),
    ),
  ).toHaveLength(1);
});

test('screen room state updates keep the host heartbeat schedule and saved quality', () => {
  jest.setSystemTime(100_000);
  mockScreenRoom = {
    id: 'room',
    roomType: 'screen',
    name: 'Screen room',
    ownerName: 'Host',
  };
  Object.defineProperty(window, 'isSecureContext', {
    configurable: true,
    value: true,
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getDisplayMedia: jest.fn() },
  });
  window.RTCPeerConnection = jest.fn();
  jest.spyOn(window, 'open').mockImplementation(() => null);
  localStorage.setItem('watch_room_screen_quality', 'hd');
  const view = render(React.createElement(WatchRoomScreenPage));
  expect(screen.getByRole('combobox')).toHaveValue('hd');
  expect(localStorage.getItem('watch_room_screen_quality')).toBe('hd');
  act(() => jest.advanceTimersByTime(10_000));
  mockScreenRoom = { ...mockScreenRoom, currentState: { updatedAt: 110_000 } };
  view.rerender(React.createElement(WatchRoomScreenPage));
  expect(localStorage.getItem('watch_room_no_connect_timestamp')).toBe(
    '100000',
  );
  act(() => jest.advanceTimersByTime(20_000));
  expect(localStorage.getItem('watch_room_no_connect_timestamp')).toBe(
    '130000',
  );
  view.unmount();
  expect(localStorage.getItem('watch_room_no_connect')).toBeNull();
});

test('disabled web-live shows the feature notice without fetching sources', async () => {
  window.RUNTIME_CONFIG = { WEB_LIVE_ENABLED: false };
  global.fetch = jest.fn();
  await act(async () => render(React.createElement(WebLivePage)));
  expect(screen.getByText('功能未启用')).toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('web-live starts its initial request immediately and keeps loading through the existing display delay', async () => {
  window.RUNTIME_CONFIG = { WEB_LIVE_ENABLED: true };
  let resolveSources;
  global.fetch = jest.fn(
    () =>
      new Promise((resolve) => {
        resolveSources = resolve;
      }),
  );
  render(React.createElement(WebLivePage));
  expect(global.fetch.mock.calls[0][0]).toBe('/api/web-live/sources');
  expect(screen.getByText('正在加载直播源...')).toBeInTheDocument();
  await act(async () => resolveSources({ ok: true, json: async () => [] }));
  await act(async () => jest.advanceTimersByTime(499));
  expect(screen.getByText('正在加载直播源...')).toBeInTheDocument();
  await act(async () => jest.advanceTimersByTime(1));
  expect(screen.queryByText('正在加载直播源...')).not.toBeInTheDocument();
});

test('web-live URL selection starts one stream request and creates the requested player after loading', async () => {
  window.RUNTIME_CONFIG = { WEB_LIVE_ENABLED: true };
  mockSearchParams = new URLSearchParams('platform=bilibili&roomId=123');
  const source = {
    key: 'bili-123',
    name: 'Test room',
    platform: 'bilibili',
    roomId: '123',
  };
  global.fetch = jest.fn(async (url) => ({
    ok: true,
    json: async () =>
      url === '/api/web-live/sources'
        ? [source]
        : { url: 'https://example.com/live.m3u8' },
  }));
  await act(async () => render(React.createElement(WebLivePage)));
  await act(async () => jest.advanceTimersByTimeAsync(550));
  await act(async () => jest.advanceTimersByTimeAsync(32));
  expect(global.fetch.mock.calls.map(([url]) => url)).toEqual([
    '/api/web-live/sources',
    '/api/web-live/stream?platform=bilibili&roomId=123',
  ]);
  expect(mockWebPlayers).toHaveLength(1);
  expect(mockWebPlayers[0].url).toBe('https://example.com/live.m3u8');
  expect(mockRouter.replace).toHaveBeenCalledWith(
    '/web-live?platform=bilibili&roomId=123',
  );
});

test('web-live cancels its pending source request when the page unmounts', async () => {
  window.RUNTIME_CONFIG = { WEB_LIVE_ENABLED: true };
  let resolveSources;
  global.fetch = jest.fn(
    () =>
      new Promise((resolve) => {
        resolveSources = resolve;
      }),
  );
  const view = render(React.createElement(WebLivePage));
  const requestOptions = global.fetch.mock.calls[0][1];
  view.unmount();
  expect(requestOptions?.signal?.aborted).toBe(true);
  const readBody = jest.fn(async () => []);
  await act(async () => resolveSources({ ok: true, json: readBody }));
  expect(readBody).not.toHaveBeenCalled();
});

test('TV QR login starts immediately, preserves its redirect, and stops polling on unmount', async () => {
  mockSearchParams = new URLSearchParams('redirect=/tv/private');
  global.fetch = jest.fn(async (url) => ({
    ok: true,
    json: async () =>
      url === '/api/auth/qr/create'
        ? {
            token: 'qr-token',
            qrUrl: '/qr-login?token=qr-token',
            expiresAt: Date.now() + 60_000,
            ttl: 60,
          }
        : { status: 'confirmed' },
  }));
  const view = render(React.createElement(TVLoginPage));
  expect(global.fetch).toHaveBeenCalledWith('/api/auth/qr/create', {
    method: 'POST',
  });
  await act(async () => undefined);
  await act(async () => jest.advanceTimersByTimeAsync(2000));
  expect(global.fetch).toHaveBeenCalledWith(
    '/api/auth/qr/status?token=qr-token',
    { cache: 'no-store' },
  );
  expect(mockRouter.replace).toHaveBeenCalledWith('/tv/private');
  view.unmount();
  const callsAtUnmount = global.fetch.mock.calls.length;
  await act(async () => jest.advanceTimersByTimeAsync(60_000));
  expect(global.fetch).toHaveBeenCalledTimes(callsAtUnmount);
});
