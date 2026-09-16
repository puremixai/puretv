const React = require('react');
const {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} = require('@testing-library/react');

// Image transport is external; keep the real panel, hero and motion lifecycle.
jest.mock('@/components/ProxyImage', () => ({
  __esModule: true,
  default: ({
    originalSrc,
    displaySrc,
    fetchPriority: _fetchPriority,
    retryOnError: _retryOnError,
    retryDelay: _retryDelay,
    ...props
  }) =>
    React.createElement('img', { ...props, src: displaySrc || originalSrc }),
}));

const DetailPanel = require('../src/components/DetailPanel').default;

const TITLE = '海岸之夜';
const INTRO = '一段用于验证详情完整保留的影片简介。';
const POSTER = 'https://image.tmdb.org/t/p/w500/coast-poster.jpg';
const BACKDROP = 'https://image.tmdb.org/t/p/w1280/coast-backdrop.jpg';
const ORIGINAL_POSTER = 'https://images.example.test/original-poster.jpg';
const originalFetch = global.fetch;
const originalMatchMedia = window.matchMedia;
const originalScrollTo = window.scrollTo;

beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  window.scrollTo = jest.fn();
  window.matchMedia = jest.fn((media) => ({
    media,
    matches: false,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
  }));
  global.fetch = jest.fn(async (url) => {
    if (url.startsWith('/api/tmdb/search?')) {
      return {
        ok: true,
        json: async () => ({ results: [{ id: 42, media_type: 'movie' }] }),
      };
    }
    if (url === '/api/tmdb/detail?id=42&type=movie') {
      return {
        ok: true,
        json: async () => ({
          id: 42,
          title: TITLE,
          original_title: 'Coastal Night',
          release_date: '2026-09-13',
          poster_path: '/coast-poster.jpg',
          backdrop_path: '/coast-backdrop.jpg',
          overview: INTRO,
          vote_average: 8.4,
          vote_count: 123,
          runtime: 112,
          genres: [{ id: 18, name: '剧情' }],
          production_countries: [],
          spoken_languages: [],
          status: 'Released',
        }),
      };
    }
    if (url === '/api/tmdb/credits?id=42&type=movie') {
      return {
        ok: true,
        json: async () => ({
          cast: [{ name: '测试演员', character: '主角', profile_path: null }],
          crew: [],
        }),
      };
    }
    throw new Error(`Unexpected request: ${url}`);
  });
});

afterEach(() => {
  cleanup();
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  global.fetch = originalFetch;
  window.matchMedia = originalMatchMedia;
  window.scrollTo = originalScrollTo;
});

async function renderPanel(props = {}) {
  const onClose = jest.fn();
  let view;
  await act(async () => {
    view = render(
      React.createElement(DetailPanel, {
        isOpen: true,
        onClose,
        title: TITLE,
        ...props,
      }),
    );
  });
  expect(screen.getByText(props.cmsData?.desc || INTRO)).toBeInTheDocument();
  act(() => jest.advanceTimersByTime(40));
  return { ...view, onClose };
}

test.each([false, true])(
  'TMDB artwork and metadata appear without another request (drawer=%s)',
  async (useDrawer) => {
    await renderPanel({ useDrawer });
    const hero = screen.getByRole('region', { name: `${TITLE} 影片预览` });
    expect(
      within(hero).getByRole('img', { name: `${TITLE} 背景` }),
    ).toHaveAttribute('src', BACKDROP);
    expect(
      within(hero).getByRole('heading', { name: TITLE }),
    ).toBeInTheDocument();
    expect(within(hero).getByText('2026')).toBeInTheDocument();
    expect(within(hero).getByText('8.4')).toBeInTheDocument();
    expect(screen.getByText(INTRO)).toBeInTheDocument();
    expect(global.fetch.mock.calls.map(([url]) => url)).toEqual([
      `/api/tmdb/search?query=${encodeURIComponent(TITLE)}`,
      '/api/tmdb/detail?id=42&type=movie',
      '/api/tmdb/credits?id=42&type=movie',
    ]);
  },
);

test('a failed backdrop falls back to a readable poster and retains image viewing', async () => {
  await renderPanel();
  const hero = screen.getByRole('region', { name: `${TITLE} 影片预览` });
  fireEvent.error(within(hero).getByRole('img', { name: `${TITLE} 背景` }));
  expect(
    within(hero).getByRole('img', { name: `${TITLE} 背景` }),
  ).toHaveAttribute('src', POSTER);
  fireEvent.click(
    within(hero).getByRole('button', { name: `查看${TITLE}海报` }),
  );
  expect(screen.getByRole('img', { name: TITLE })).toBeInTheDocument();
  expect(hero).toHaveAttribute('data-paused', 'true');
});

test('source switching replaces poster-only artwork and restores it when switching back', async () => {
  await renderPanel({
    poster: ORIGINAL_POSTER,
    cmsData: { desc: '原始来源简介' },
  });
  let hero = screen.getByRole('region', { name: `${TITLE} 影片预览` });
  expect(
    within(hero).getByRole('img', { name: `${TITLE} 背景` }),
  ).toHaveAttribute('src', ORIGINAL_POSTER);
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: '切换到 TMDB' })),
  );
  expect(screen.getByText(INTRO)).toBeInTheDocument();
  hero = screen.getByRole('region', { name: `${TITLE} 影片预览` });
  expect(
    within(hero).getByRole('img', { name: `${TITLE} 背景` }),
  ).toHaveAttribute('src', BACKDROP);
  fireEvent.click(screen.getByRole('button', { name: '切换回 CMS' }));
  expect(screen.getByText('原始来源简介')).toBeInTheDocument();
  expect(
    within(screen.getByRole('region', { name: `${TITLE} 影片预览` })).getByRole(
      'img',
      { name: `${TITLE} 背景` },
    ),
  ).toHaveAttribute('src', ORIGINAL_POSTER);
});

test('motion can be paused and resumed, and closing pauses the outgoing hero immediately', async () => {
  const view = await renderPanel();
  const hero = screen.getByRole('region', { name: `${TITLE} 影片预览` });
  fireEvent.click(within(hero).getByRole('button', { name: '暂停动态效果' }));
  expect(hero).toHaveAttribute('data-paused', 'true');
  fireEvent.click(within(hero).getByRole('button', { name: '继续动态效果' }));
  expect(hero).toHaveAttribute('data-paused', 'false');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(view.onClose).toHaveBeenCalledTimes(1);
  view.rerender(
    React.createElement(DetailPanel, {
      isOpen: false,
      onClose: view.onClose,
      title: TITLE,
    }),
  );
  expect(hero).toHaveAttribute('data-paused', 'true');
  act(() => jest.advanceTimersByTime(200));
  expect(
    screen.queryByRole('region', { name: `${TITLE} 影片预览` }),
  ).not.toBeInTheDocument();
});

test('missing artwork retains a readable title and the existing close action', async () => {
  const view = await renderPanel({ cmsData: { desc: '只有文字的详情' } });
  const hero = screen.getByRole('region', { name: `${TITLE} 影片预览` });
  expect(within(hero).queryByRole('img')).not.toBeInTheDocument();
  expect(
    within(hero).getByRole('heading', { name: TITLE }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '关闭', exact: true }));
  expect(view.onClose).toHaveBeenCalledTimes(1);
});

test('an empty credits result is complete and is not fetched repeatedly', async () => {
  const normalFetch = global.fetch;
  let creditsRequests = 0;
  global.fetch = jest.fn(async (url) => {
    if (url.includes('/credits?')) {
      creditsRequests += 1;
      return {
        ok: creditsRequests === 1,
        json: async () => ({ cast: [], crew: [] }),
      };
    }
    return normalFetch(url);
  });
  await renderPanel();
  expect(creditsRequests).toBe(1);
});

test('artwork from the caller appears while the detail request is pending', async () => {
  global.fetch = jest.fn(() => new Promise(() => {}));
  render(
    React.createElement(DetailPanel, {
      isOpen: true,
      onClose: jest.fn(),
      title: TITLE,
      poster: POSTER,
      backdrop: BACKDROP,
    }),
  );
  const hero = screen.getByRole('region', { name: `${TITLE} 影片预览` });
  expect(
    within(hero).getByRole('img', { name: `${TITLE} 背景` }),
  ).toHaveAttribute('src', BACKDROP);
  expect(
    within(hero).getByRole('heading', { name: TITLE }),
  ).toBeInTheDocument();
});

test('late details from the previous title cannot replace the newly selected film', async () => {
  let finishOldSearch;
  const normalFetch = global.fetch;
  global.fetch = jest.fn((url) => {
    if (url.includes(encodeURIComponent('旧影片')))
      return new Promise((resolve) => {
        finishOldSearch = resolve;
      });
    return normalFetch(url);
  });
  const props = { isOpen: true, onClose: jest.fn(), title: '旧影片' };
  const view = render(React.createElement(DetailPanel, props));
  await act(async () =>
    view.rerender(React.createElement(DetailPanel, { ...props, title: TITLE })),
  );
  expect(screen.getByText(INTRO)).toBeInTheDocument();
  await act(async () =>
    finishOldSearch({ ok: true, json: async () => ({ results: [] }) }),
  );
  expect(screen.getByText(INTRO)).toBeInTheDocument();
  expect(screen.queryByText('未找到相关内容')).not.toBeInTheDocument();
});

test('Escape closes the image viewer first and dialog focus returns to its opener', async () => {
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  const props = { poster: ORIGINAL_POSTER, cmsData: { desc: '原始来源简介' } };
  const view = await renderPanel(props);
  const dialog = screen.getByRole('dialog', { name: `${TITLE}详情` });
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(dialog).toContainElement(document.activeElement);
  fireEvent.click(screen.getByRole('button', { name: `查看${TITLE}海报` }));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(view.onClose).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(200));
  expect(screen.queryByRole('img', { name: TITLE })).not.toBeInTheDocument();
  view.rerender(
    React.createElement(DetailPanel, {
      ...props,
      isOpen: false,
      title: TITLE,
      onClose: view.onClose,
    }),
  );
  act(() => jest.advanceTimersByTime(200));
  expect(document.activeElement).toBe(opener);
  opener.remove();
});

test('a failed new selection keeps its own hero instead of the previous film', async () => {
  const view = await renderPanel();
  const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
  global.fetch = jest.fn(async () => ({ ok: false }));
  try {
    await act(async () => {
      view.rerender(
        React.createElement(DetailPanel, {
          isOpen: true,
          onClose: view.onClose,
          title: '新的影片',
          backdrop: 'https://images.example.test/new-backdrop.jpg',
        }),
      );
    });
    expect(screen.getByText('搜索失败')).toBeInTheDocument();
    const hero = screen.getByRole('region', { name: '新的影片 影片预览' });
    expect(
      within(hero).getByRole('img', { name: '新的影片 背景' }),
    ).toHaveAttribute('src', 'https://images.example.test/new-backdrop.jpg');
    expect(within(hero).queryByText('8.4')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: `${TITLE} 影片预览` }),
    ).not.toBeInTheDocument();
  } finally {
    errorLog.mockRestore();
  }
});

test('reopening the same film restarts unfinished credits and ignores their old response', async () => {
  const normalFetch = global.fetch;
  let finishOldCredits;
  let creditsRequests = 0;
  global.fetch = jest.fn((url) => {
    if (url.includes('/credits?')) {
      creditsRequests += 1;
      if (creditsRequests === 1) {
        return new Promise((resolve) => {
          finishOldCredits = resolve;
        });
      }
    }
    return normalFetch(url);
  });
  const view = await renderPanel();
  const props = { title: TITLE, onClose: view.onClose };
  view.rerender(React.createElement(DetailPanel, { ...props, isOpen: false }));
  act(() => jest.advanceTimersByTime(200));
  await act(async () =>
    view.rerender(React.createElement(DetailPanel, { ...props, isOpen: true })),
  );
  expect(creditsRequests).toBe(2);
  expect(screen.getByText('测试演员')).toBeInTheDocument();
  await act(async () =>
    finishOldCredits({
      ok: true,
      json: async () => ({
        cast: [{ name: '过期演员', character: '旧角色', profile_path: null }],
        crew: [],
      }),
    }),
  );
  expect(screen.queryByText('过期演员')).not.toBeInTheDocument();
  expect(screen.getByText('测试演员')).toBeInTheDocument();
});
