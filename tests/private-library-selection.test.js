const React = require('react');
const {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} = require('@testing-library/react');
const router = require('next-router-mock').default;

jest.mock('next/navigation', () => {
  const React = require('react');
  const memoryRouter = require('next-router-mock');
  return {
    useRouter: () => memoryRouter.default,
    useSearchParams: () => {
      const { query } = memoryRouter.useRouter();
      const serialized = new URLSearchParams(query).toString();
      return React.useMemo(() => new URLSearchParams(serialized), [serialized]);
    },
  };
});
// Keep the library controls and request lifecycle; omit the unrelated app shell/player.
jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }) => children,
}));
jest.mock('@/components/VideoCard', () => ({
  __esModule: true,
  default: ({ title }) => React.createElement('article', null, title),
}));

const PrivateLibraryPage = require('../src/app/private-library/page').default;
const originalFetch = global.fetch;
const originalObserver = global.IntersectionObserver;
const originalConfig = window.RUNTIME_CONFIG;
const response = (body) => ({ ok: true, json: async () => body });

async function settle() {
  await act(async () => {});
  // Flush the zero-delay reset and the URL update it may cause, without advancing polling.
  for (let step = 0; step < 6; step += 1) {
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
  }
}

beforeEach(() => {
  jest.useFakeTimers();
  router.setCurrentUrl('/private-library?source=emby:main');
  window.RUNTIME_CONFIG = {
    PRIVATE_LIBRARY_ENABLED: true,
    OPENLIST_ENABLED: false,
    EMBY_ENABLED: true,
  };
  global.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  global.fetch = jest.fn(async (input) => {
    const url = new URL(input, 'http://localhost');
    if (url.pathname === '/api/emby/sources') {
      return response({
        sources: [
          { key: 'main', name: '主服务器' },
          { key: 'second', name: '备用服务器' },
        ],
      });
    }
    if (url.pathname === '/api/emby/views') {
      return response({
        views: [{ id: 'movies', name: '电影分类', type: 'movies' }],
      });
    }
    if (url.pathname === '/api/emby/list') {
      return response({
        list: [
          {
            id: 'film',
            title:
              url.searchParams.get('parentId') === 'movies'
                ? '分类内影片'
                : '全部影片',
            mediaType: 'movie',
            poster: '',
          },
        ],
        page: 1,
        totalPages: 1,
      });
    }
    throw new Error(`Unexpected request: ${input}`);
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  global.fetch = originalFetch;
  global.IntersectionObserver = originalObserver;
  window.RUNTIME_CONFIG = originalConfig;
});

test('selecting an Emby view survives synchronization to the URL', async () => {
  render(React.createElement(PrivateLibraryPage));
  await settle();
  fireEvent.click(screen.getByRole('button', { name: '电影分类' }));
  await settle();
  expect(router.query.view).toBe('movies');
  expect(screen.getByText('分类内影片')).toBeInTheDocument();
});

test('switching Emby servers clears the previous server view', async () => {
  render(React.createElement(PrivateLibraryPage));
  await settle();
  fireEvent.click(screen.getByRole('button', { name: '电影分类' }));
  await settle();
  fireEvent.click(screen.getByRole('button', { name: '备用服务器' }));
  await settle();
  expect(router.query.source).toBe('emby:second');
  expect(router.query.view).toBeUndefined();
  expect(screen.getByText('全部影片')).toBeInTheDocument();
});
