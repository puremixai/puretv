const originalFetch = global.fetch;
afterEach(() => {
  delete window.RUNTIME_CONFIG;
  global.fetch = originalFetch;
  localStorage.clear();
});
test('disabled runtime blocks all five client retrieval methods, including old local preferences', async () => {
  window.RUNTIME_CONFIG = { DANMAKU_ENABLED: false };
  localStorage.setItem('disableAutoLoadDanmaku', 'false');
  localStorage.setItem('danmaku_display_enabled', 'true');
  global.fetch = jest.fn();
  const api = require('../src/lib/danmaku/api');
  const responses = await Promise.all([
    api.searchAnime('电影'),
    api.matchAnime('电影'),
    api.getEpisodes(1),
    api.getDanmakuById(1, '电影', 0),
    api.getDanmakuByUrl('https://video.example/film'),
  ]);
  expect(responses.slice(0, 3).every((response) => response.disabled)).toBe(
    true
  );
  expect(responses.slice(3)).toEqual([[], []]);
  expect(global.fetch).not.toHaveBeenCalled();
});
