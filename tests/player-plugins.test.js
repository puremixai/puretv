const mockDanmakuLoad = jest.fn();
const mockThumbnailLoad = jest.fn();
jest.mock('artplayer-plugin-danmuku', () => {
  mockDanmakuLoad();
  return { default: jest.fn(), __esModule: true };
});
jest.mock('../src/lib/artplayer-plugin-auto-thumbnail', () => {
  mockThumbnailLoad();
  return { default: jest.fn(), __esModule: true };
});
beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
});
test('disabled plugins are neither imported nor initialized', async () => {
  const {
    loadPlayerPlugins,
  } = require('../src/components/player/load-player-plugins');
  expect(
    await loadPlayerPlugins({ danmaku: false, thumbnails: false })
  ).toEqual({ danmaku: undefined, thumbnails: undefined });
  expect(mockDanmakuLoad).not.toHaveBeenCalled();
  expect(mockThumbnailLoad).not.toHaveBeenCalled();
});
test.each([
  [true, false],
  [false, true],
  [true, true],
])(
  'plugins can be independently enabled (%s, %s)',
  async (danmaku, thumbnails) => {
    const {
      loadPlayerPlugins,
    } = require('../src/components/player/load-player-plugins');
    const loaded = await loadPlayerPlugins({ danmaku, thumbnails });
    expect(Boolean(loaded.danmaku)).toBe(danmaku);
    expect(Boolean(loaded.thumbnails)).toBe(thumbnails);
    expect(mockDanmakuLoad).toHaveBeenCalledTimes(Number(danmaku));
    expect(mockThumbnailLoad).toHaveBeenCalledTimes(Number(thumbnails));
  }
);
