const React = require('react');
const { act, cleanup, render, screen } = require('@testing-library/react');
const router = require('next-router-mock').default;

jest.mock('next/navigation', () => {
  const React = require('react');
  const memoryRouter = require('next-router-mock');
  return {
    useSearchParams: () => {
      const { query } = memoryRouter.useRouter();
      const serialized = new URLSearchParams(query).toString();
      return React.useMemo(() => new URLSearchParams(serialized), [serialized]);
    },
  };
});
// Storage is external to the reader; model its synchronous cache hit as a resolved Promise.
let mockRecords = {};
jest.mock('@/lib/db.client', () => ({
  getAllMangaReadRecords: async () => mockRecords,
  getAllMangaShelf: async () => ({}),
  saveMangaReadRecord: async () => {},
  saveMangaShelf: async () => {},
}));
jest.mock('@/components/ProxyImage', () => ({
  __esModule: true,
  default: ({ originalSrc, ...props }) =>
    React.createElement('img', { ...props, src: originalSrc }),
}));

const MangaReadPage = require('../src/app/manga/read/page').default;
const originalFetch = global.fetch;
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
const response = (body) => ({ ok: true, json: async () => body });
const readerUrl = (chapterId) =>
  `/manga/read?mangaId=manga&sourceId=source&chapterId=${chapterId}&chapterName=${chapterId}`;
const pages = (chapterId) =>
  Array.from(
    { length: 20 },
    (_, index) => `https://example.test/${chapterId}/${index}.jpg`,
  );
let resolveNextChapter;

beforeEach(() => {
  jest.useFakeTimers();
  HTMLElement.prototype.scrollIntoView = jest.fn();
  localStorage.clear();
  localStorage.setItem('mangaReadMode', 'single');
  router.setCurrentUrl(readerUrl('A'));
  mockRecords = {
    'source+manga': {
      sourceId: 'source',
      mangaId: 'manga',
      chapterId: 'B',
      chapterName: 'B',
      title: '漫画',
      cover: '',
      sourceName: 'source',
      pageIndex: 7,
      pageCount: 20,
      saveTime: 1,
    },
  };
  global.fetch = jest.fn(async (input) => {
    const url = new URL(input, 'http://localhost');
    if (url.pathname === '/api/manga/detail') return response({ chapters: [] });
    if (url.pathname === '/api/manga/pages') {
      if (url.searchParams.get('chapterId') === 'B') {
        return new Promise((resolve) => {
          resolveNextChapter = () => resolve(response({ pages: pages('B') }));
        });
      }
      return response({ pages: pages('A') });
    }
    throw new Error(`Unexpected request: ${input}`);
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  localStorage.clear();
  global.fetch = originalFetch;
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
});

test('cached reading position survives the chapter reset when chapter page counts match', async () => {
  render(React.createElement(MangaReadPage));
  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(screen.getByText('1/20')).toBeInTheDocument();

  await act(async () => {
    await router.push(readerUrl('B'));
  });
  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  await act(async () => {
    resolveNextChapter();
  });

  expect(screen.getByText('8/20')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'B-8' })).toHaveAttribute(
    'src',
    'https://example.test/B/7.jpg',
  );
});

test('loading the reader keeps the saved single-page preference', async () => {
  render(React.createElement(MangaReadPage));
  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(localStorage.getItem('mangaReadMode')).toBe('single');
  expect(screen.getAllByRole('img')).toHaveLength(1);
});
