const React = require('react');
const {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} = require('@testing-library/react');

const mockRouterPush = jest.fn();
const mockDetailProps = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));
// The lazy detail boundary owns its own network and close animation tests.
// Here its public props and close callback exercise the real banner state.
jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => (props) => {
    mockDetailProps(props);
    return props.isOpen
      ? React.createElement(
          'section',
          { role: 'dialog', 'aria-label': props.title },
          React.createElement(
            'button',
            { onClick: props.onClose },
            '关闭影片详情',
          ),
        )
      : null;
  },
}));
jest.mock('@/lib/douban.client', () => ({ getDoubanDetail: jest.fn() }));

// Keep carousel state and timing real; image loading is outside this regression.
jest.mock('@/components/ProxyImage', () => ({
  __esModule: true,
  default: ({ originalSrc, fetchPriority: _fetchPriority, ...props }) =>
    React.createElement('img', { ...props, src: originalSrc }),
}));

const BannerCarousel = require('../src/components/BannerCarousel').default;
const { renderToString } = require('react-dom/server.node');

const INTERVAL = 9000;
const TITLES = ['第一部测试影片', '第二部测试影片', '第三部测试影片'];
const ITEMS = TITLES.map((title, index) => ({
  id: index + 1,
  title,
  backdrop_path: `https://images.example.test/banner-${index + 1}.jpg`,
  poster_path: `https://images.example.test/poster-${index + 1}.jpg`,
  release_date: '2026-09-13',
  overview: '用于验证首页轮播交互的固定影片。',
  vote_average: 8,
  media_type: 'movie',
  genre_ids: [],
  tags: ['剧情'],
}));

const originalFetch = global.fetch;
const originalMatchMedia = window.matchMedia;
const originalPointerEvent = window.PointerEvent;
const originalHidden = Object.getOwnPropertyDescriptor(document, 'hidden');
let hidden;
let reducedMotion;
let motionListeners;
let expectedFetches;

function advance(milliseconds) {
  act(() => jest.advanceTimersByTime(milliseconds));
}

function expectSlide(index) {
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    TITLES[index],
  );
}

function focus(element) {
  act(() => element.focus());
}

function pointerClick(element) {
  fireEvent.pointerDown(element, { pointerType: 'mouse', button: 0 });
  fireEvent.mouseDown(element, { button: 0 });
  focus(element);
  fireEvent.pointerUp(element, { pointerType: 'mouse', button: 0 });
  fireEvent.mouseUp(element, { button: 0 });
  fireEvent.click(element, { button: 0, detail: 1 });
}

function setHidden(value) {
  hidden = value;
  fireEvent(document, new Event('visibilitychange'));
}

function renderCarousel({ count = 3, reduce = false } = {}) {
  reducedMotion = reduce;
  localStorage.setItem(
    'banner_trending_cache_TX',
    JSON.stringify({ data: ITEMS.slice(0, count), timestamp: Date.now() }),
  );
  return render(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(BannerCarousel, { autoPlayInterval: INTERVAL }),
      React.createElement('button', null, '轮播外的按钮'),
    ),
  );
}

test('server data includes the first title and artwork before hydration', () => {
  const html = renderToString(
    React.createElement(BannerCarousel, {
      initialData: { code: 200, list: ITEMS, source: 'TX' },
    }),
  );
  expect(html).toContain(TITLES[0]);
  expect(html).toContain('https://images.example.test/banner-1.jpg');
});

test('server data takes precedence over old browser artwork without a second request', () => {
  localStorage.setItem(
    'banner_trending_cache_TX',
    JSON.stringify({
      data: [{ ...ITEMS[0], title: '旧轮播内容' }],
      timestamp: Date.now(),
    }),
  );
  render(
    React.createElement(BannerCarousel, {
      initialData: { code: 200, list: ITEMS, source: 'TX' },
    }),
  );
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    TITLES[0],
  );
});

test('a late client fetch cannot replace a newer server seed or write its stale cache', async () => {
  expectedFetches = 1;
  let complete;
  global.fetch = jest.fn(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const view = render(React.createElement(BannerCarousel));
  const requestSignal = global.fetch.mock.calls[0][1]?.signal;
  view.rerender(
    React.createElement(BannerCarousel, {
      initialData: { code: 200, source: 'TX', list: ITEMS },
    }),
  );
  await act(async () =>
    complete({
      json: async () => ({
        code: 200,
        source: 'TX',
        list: [{ ...ITEMS[0], title: '过期请求的影片' }],
      }),
    }),
  );
  expectSlide(0);
  expect(localStorage.getItem('banner_trending_cache_TX')).toBeNull();
  expect(requestSignal?.aborted).toBe(true);
});

test('late Douban trailers cannot replace a newer same-length server seed', async () => {
  localStorage.setItem('enableTrailers', 'true');
  const { getDoubanDetail } = require('../src/lib/douban.client');
  let finishOldTrailers;
  getDoubanDetail.mockImplementation(
    (id) =>
      new Promise((resolve) => {
        if (id === String(ITEMS[0].id)) finishOldTrailers = resolve;
      }),
  );
  const view = render(
    React.createElement(BannerCarousel, {
      initialData: { code: 200, source: 'Douban', list: [ITEMS[0]] },
    }),
  );
  view.rerender(
    React.createElement(BannerCarousel, {
      initialData: { code: 200, source: 'Douban', list: [ITEMS[1]] },
    }),
  );
  await act(async () => finishOldTrailers({ trailers: [] }));
  expectSlide(1);
  expect(getDoubanDetail).toHaveBeenCalledTimes(2);
});

test('a shorter refreshed seed still has a selected backdrop', () => {
  const view = render(
    React.createElement(BannerCarousel, {
      initialData: { code: 200, source: 'TX', list: ITEMS },
      autoPlayInterval: INTERVAL,
    }),
  );
  advance(INTERVAL);
  advance(INTERVAL);
  expectSlide(2);
  view.rerender(
    React.createElement(BannerCarousel, {
      initialData: { code: 200, source: 'TX', list: [ITEMS[0]] },
    }),
  );
  expectSlide(0);
  expect(
    view.container.querySelector('.cinema-hero-slide[data-active="true"] img'),
  ).toHaveAttribute('src', ITEMS[0].backdrop_path);
});

beforeEach(() => {
  mockRouterPush.mockReset();
  mockDetailProps.mockReset();
  require('../src/lib/douban.client').getDoubanDetail.mockReset();
  expectedFetches = 0;
  jest.useFakeTimers('modern');
  jest.setSystemTime(new Date('2026-09-13T08:00:00Z'));
  localStorage.clear();
  localStorage.setItem('enableTrailers', 'false');
  hidden = false;
  reducedMotion = false;
  motionListeners = new Set();
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden,
  });
  window.matchMedia = jest.fn((query) => ({
    media: query,
    get matches() {
      return reducedMotion;
    },
    addEventListener: (_type, listener) => motionListeners.add(listener),
    removeEventListener: (_type, listener) => motionListeners.delete(listener),
  }));
  window.PointerEvent = class extends MouseEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.pointerType = init.pointerType || 'mouse';
    }
  };
  global.fetch = jest.fn(async () => {
    throw new Error('The fresh TX cache should avoid network requests');
  });
});

afterEach(() => {
  cleanup();
  expect(global.fetch).toHaveBeenCalledTimes(expectedFetches);
  jest.clearAllTimers();
  jest.useRealTimers();
  localStorage.clear();
  global.fetch = originalFetch;
  window.matchMedia = originalMatchMedia;
  window.PointerEvent = originalPointerEvent;
  if (originalHidden) {
    Object.defineProperty(document, 'hidden', originalHidden);
  } else {
    delete document.hidden;
  }
});

test('rotates cached homepage slides every nine seconds and wraps to the first', () => {
  renderCarousel();
  expectSlide(0);
  advance(INTERVAL - 1);
  expectSlide(0);
  advance(1);
  expectSlide(1);
  advance(INTERVAL);
  expectSlide(2);
  advance(INTERVAL);
  expectSlide(0);
});

test.each([
  ['hero', () => screen.getByRole('region', { name: '精选推荐' })],
  [
    'film picker',
    () => screen.getByRole('navigation', { name: '切换精选影片' }),
  ],
])(
  'a pointer resting over the %s does not disable automatic rotation',
  (_name, getArea) => {
    renderCarousel();
    fireEvent.mouseEnter(getArea());
    advance(INTERVAL);
    expectSlide(1);
  },
);

test('a pointer click on next keeps focus without preventing the following automatic slide', () => {
  renderCarousel();
  const next = screen.getByRole('button', { name: '下一部推荐' });
  pointerClick(next);
  expect(next).toHaveFocus();
  expectSlide(1);
  advance(INTERVAL - 1);
  expectSlide(1);
  advance(1);
  expect(next).toHaveFocus();
  expectSlide(2);
});

test('manual selection restarts one full interval without skipping an extra cycle', () => {
  renderCarousel();
  advance(INTERVAL / 2);
  pointerClick(
    screen.getByRole('button', { name: `选择精选影片：${TITLES[1]}` }),
  );
  focus(screen.getByRole('button', { name: '轮播外的按钮' }));
  expectSlide(1);
  advance(INTERVAL - 1);
  expectSlide(1);
  advance(1);
  expectSlide(2);
});

test('clicking the current dot also restarts a full rotation interval', () => {
  renderCarousel();
  advance(INTERVAL / 2);
  pointerClick(screen.getByRole('button', { name: `查看推荐：${TITLES[0]}` }));
  focus(screen.getByRole('button', { name: '轮播外的按钮' }));
  advance(INTERVAL - 1);
  expectSlide(0);
  advance(1);
  expectSlide(1);
});

test('explicit pause remains paused and continue works while its button retains focus', () => {
  renderCarousel();
  pointerClick(screen.getByRole('button', { name: '暂停自动轮播' }));
  focus(screen.getByRole('button', { name: '轮播外的按钮' }));
  advance(INTERVAL * 2);
  expectSlide(0);
  const resume = screen.getByRole('button', { name: '继续自动轮播' });
  pointerClick(resume);
  expect(resume).toHaveFocus();
  advance(INTERVAL);
  expectSlide(1);
});

test('Tab focus pauses rotation and moving keyboard focus outside restarts it', () => {
  renderCarousel();
  advance(INTERVAL / 2);
  fireEvent.keyDown(document, { key: 'Tab', code: 'Tab' });
  focus(screen.getByRole('button', { name: '下一部推荐' }));
  advance(INTERVAL * 2);
  expectSlide(0);
  fireEvent.keyDown(document, { key: 'Tab', code: 'Tab' });
  focus(screen.getByRole('button', { name: '轮播外的按钮' }));
  advance(INTERVAL - 1);
  expectSlide(0);
  advance(1);
  expectSlide(1);
});

test('a hidden page pauses and becoming visible starts a new complete interval', () => {
  renderCarousel();
  advance(INTERVAL / 2);
  setHidden(true);
  advance(INTERVAL * 2);
  expectSlide(0);
  setHidden(false);
  advance(INTERVAL - 1);
  expectSlide(0);
  advance(1);
  expectSlide(1);
});

test('reduced motion defaults to paused but offers an explicit way to start rotation', () => {
  renderCarousel({ reduce: true });
  advance(INTERVAL * 2);
  expectSlide(0);
  pointerClick(screen.getByRole('button', { name: '继续自动轮播' }));
  advance(INTERVAL);
  expectSlide(1);
  pointerClick(screen.getByRole('button', { name: '暂停自动轮播' }));
  advance(INTERVAL * 2);
  expectSlide(1);
});

test('a single cached slide stays selected without automatic rotation controls', () => {
  renderCarousel({ count: 1 });
  advance(INTERVAL * 3);
  expectSlide(0);
  expect(
    screen.queryByRole('button', { name: '下一部推荐' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: '暂停自动轮播' }),
  ).not.toBeInTheDocument();
});

test('unmounting clears both rotation and pending manual-interaction timers', () => {
  const view = renderCarousel();
  pointerClick(screen.getByRole('button', { name: '下一部推荐' }));
  view.unmount();
  expect(jest.getTimerCount()).toBe(0);
  expect(motionListeners.size).toBe(0);
});

test('the info action opens the selected film, pauses rotation, and closing restarts a full interval', () => {
  renderCarousel();
  pointerClick(screen.getByRole('button', { name: '下一部推荐' }));
  advance(INTERVAL / 2);
  pointerClick(
    screen.getByRole('button', { name: `查看影片详情：${TITLES[1]}` }),
  );
  expect(screen.getByRole('dialog', { name: TITLES[1] })).toBeInTheDocument();
  expect(mockDetailProps).toHaveBeenLastCalledWith(
    expect.objectContaining({
      isOpen: true,
      title: TITLES[1],
      poster: ITEMS[1].poster_path,
      type: 'movie',
      cmsData: { desc: ITEMS[1].overview },
    }),
  );
  advance(INTERVAL * 2);
  expectSlide(1);
  pointerClick(screen.getByRole('button', { name: '关闭影片详情' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  advance(INTERVAL - 1);
  expectSlide(1);
  advance(1);
  expectSlide(2);

  pointerClick(screen.getByRole('button', { name: '立即观看' }));
  expect(mockRouterPush).toHaveBeenLastCalledWith(
    `/play?title=${encodeURIComponent(TITLES[2])}`,
  );
  pointerClick(screen.getByRole('button', { name: '搜索片源' }));
  expect(mockRouterPush).toHaveBeenLastCalledWith(
    `/search?q=${encodeURIComponent(TITLES[2])}`,
  );
});

test('TMDB details receive the series identity and closing them preserves an explicit rotation pause', () => {
  render(
    React.createElement(BannerCarousel, {
      autoPlayInterval: INTERVAL,
      initialData: {
        code: 200,
        source: 'TMDB',
        list: [{ ...ITEMS[0], id: '42', media_type: 'tv' }, ITEMS[1]],
      },
    }),
  );
  pointerClick(screen.getByRole('button', { name: '暂停自动轮播' }));
  pointerClick(
    screen.getByRole('button', { name: `查看影片详情：${TITLES[0]}` }),
  );
  expect(mockDetailProps).toHaveBeenLastCalledWith(
    expect.objectContaining({
      title: TITLES[0],
      tmdbId: 42,
      doubanId: undefined,
      type: 'tv',
      cmsData: undefined,
    }),
  );
  pointerClick(screen.getByRole('button', { name: '关闭影片详情' }));
  expect(
    screen.getByRole('button', { name: '继续自动轮播' }),
  ).toBeInTheDocument();
  advance(INTERVAL * 2);
  expectSlide(0);
});

test('open details keep their provider identity when a new banner seed changes data source', () => {
  const view = render(
    React.createElement(BannerCarousel, {
      initialData: {
        code: 200,
        source: 'Douban',
        list: [{ ...ITEMS[0], id: '71' }],
      },
    }),
  );
  pointerClick(
    screen.getByRole('button', { name: `查看影片详情：${TITLES[0]}` }),
  );
  expect(screen.getByRole('dialog', { name: TITLES[0] })).toBeInTheDocument();

  view.rerender(
    React.createElement(BannerCarousel, {
      initialData: {
        code: 200,
        source: 'TMDB',
        list: [{ ...ITEMS[1], id: '99', media_type: 'tv' }],
      },
    }),
  );
  expectSlide(1);
  expect(mockDetailProps).toHaveBeenLastCalledWith(
    expect.objectContaining({
      isOpen: true,
      title: TITLES[0],
      type: 'movie',
      doubanId: 71,
      tmdbId: undefined,
      cmsData: undefined,
    }),
  );
});
