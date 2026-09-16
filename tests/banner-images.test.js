const React = require('react');
const { cleanup, fireEvent, render } = require('@testing-library/react');

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

// Exercise the actual ProxyImage so responsive sources cannot bypass its fallback.
const BannerCarousel = require('../src/components/BannerCarousel').default;

const originalMatchMedia = window.matchMedia;
const originalRuntimeConfig = window.RUNTIME_CONFIG;
const originalFetch = global.fetch;

function renderBanner(source, artwork) {
  localStorage.setItem(
    `banner_trending_cache_${source}`,
    JSON.stringify({
      timestamp: Date.now(),
      data: [
        {
          id: 1,
          title: '图片尺寸测试',
          release_date: '2026-09-13',
          overview: '',
          vote_average: 8,
          media_type: 'movie',
          genre_ids: [],
          ...artwork,
        },
      ],
    })
  );
  const view = render(React.createElement(BannerCarousel));
  return {
    ...view,
    hero: view.container.querySelector('.cinema-backdrop'),
    thumbnail: view.container.querySelector('.cinema-feature-pick > img'),
  };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('enableTrailers', 'false');
  // Skip the unrelated global Bangumi connection probe without mocking images.
  localStorage.setItem('animeDataSource', 'server-proxy');
  delete window.RUNTIME_CONFIG;
  window.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  global.fetch = jest.fn(async () => {
    throw new Error('Fresh banner cache should not require network access');
  });
});

afterEach(() => {
  cleanup();
  expect(global.fetch).not.toHaveBeenCalled();
  localStorage.clear();
  global.fetch = originalFetch;
  window.matchMedia = originalMatchMedia;
  window.RUNTIME_CONFIG = originalRuntimeConfig;
});

test('uses bounded responsive TMDB backdrops and smaller film-picker images', () => {
  const { hero, thumbnail } = renderBanner('TMDB', {
    backdrop_path: '/landscape.jpg',
    poster_path: '/portrait.jpg',
  });

  expect(hero).toHaveAttribute(
    'src',
    'https://image.tmdb.org/t/p/w1280/landscape.jpg'
  );
  expect(hero).toHaveAttribute(
    'srcset',
    'https://image.tmdb.org/t/p/w780/landscape.jpg 780w, https://image.tmdb.org/t/p/w1280/landscape.jpg 1280w'
  );
  expect(hero).toHaveAttribute('sizes', '100vw');
  expect(hero).toHaveAttribute('loading', 'eager');
  expect(hero.getAttribute('fetchpriority')).toBe('high');
  expect(thumbnail).toHaveAttribute(
    'src',
    'https://image.tmdb.org/t/p/w300/landscape.jpg'
  );
  expect(thumbnail).toHaveAttribute(
    'srcset',
    'https://image.tmdb.org/t/p/w300/landscape.jpg 300w, https://image.tmdb.org/t/p/w780/landscape.jpg 780w'
  );
  expect(thumbnail).toHaveAttribute('sizes', '50px');
  expect(thumbnail).toHaveAttribute('loading', 'lazy');
});

test.each(['local', 'runtime'])(
  'keeps every responsive candidate on the configured %s TMDB image proxy',
  (setting) => {
    if (setting === 'local') {
      localStorage.setItem('tmdbImageBaseUrl', 'https://pictures.example/tmdb');
      window.RUNTIME_CONFIG = {
        TMDB_IMAGE_BASE_URL: 'https://unused.example',
      };
    } else {
      window.RUNTIME_CONFIG = {
        TMDB_IMAGE_BASE_URL: 'https://pictures.example/tmdb',
      };
    }
    const { hero, thumbnail } = renderBanner('TMDB', {
      backdrop_path: '/landscape.jpg',
      poster_path: '/portrait.jpg',
    });

    expect(hero).toHaveAttribute(
      'src',
      'https://pictures.example/tmdb/t/p/w1280/landscape.jpg'
    );
    expect(hero).toHaveAttribute(
      'srcset',
      'https://pictures.example/tmdb/t/p/w780/landscape.jpg 780w, https://pictures.example/tmdb/t/p/w1280/landscape.jpg 1280w'
    );
    expect(thumbnail).toHaveAttribute(
      'srcset',
      'https://pictures.example/tmdb/t/p/w300/landscape.jpg 300w, https://pictures.example/tmdb/t/p/w780/landscape.jpg 780w'
    );
  }
);

test('uses poster sizes when a TMDB item has no backdrop, including its portrait overlay', () => {
  const { container, hero, thumbnail } = renderBanner('TMDB', {
    backdrop_path: null,
    poster_path: '/portrait.jpg',
  });

  expect(hero).toHaveAttribute(
    'src',
    'https://image.tmdb.org/t/p/w780/portrait.jpg'
  );
  expect(hero).toHaveAttribute(
    'srcset',
    'https://image.tmdb.org/t/p/w342/portrait.jpg 342w, https://image.tmdb.org/t/p/w500/portrait.jpg 500w, https://image.tmdb.org/t/p/w780/portrait.jpg 780w'
  );
  expect(thumbnail).toHaveAttribute(
    'src',
    'https://image.tmdb.org/t/p/w185/portrait.jpg'
  );
  expect(thumbnail).toHaveAttribute(
    'srcset',
    'https://image.tmdb.org/t/p/w92/portrait.jpg 92w, https://image.tmdb.org/t/p/w185/portrait.jpg 185w, https://image.tmdb.org/t/p/w342/portrait.jpg 342w'
  );
  Object.defineProperties(hero, {
    naturalWidth: { value: 500 },
    naturalHeight: { value: 750 },
  });
  fireEvent.load(hero);

  const poster = container.querySelector('.cinema-hero-poster > img');
  expect(poster).toHaveAttribute(
    'src',
    'https://image.tmdb.org/t/p/w500/portrait.jpg'
  );
  expect(poster).toHaveAttribute(
    'srcset',
    'https://image.tmdb.org/t/p/w342/portrait.jpg 342w, https://image.tmdb.org/t/p/w500/portrait.jpg 500w, https://image.tmdb.org/t/p/w780/portrait.jpg 780w'
  );
  expect(poster).toHaveAttribute('sizes', '(max-width: 767px) 207px, 360px');
});

test.each([
  'http://images.example/banner.jpg',
  'https://images.example/banner.jpg',
])(
  'preserves the complete TX image URL %s without overriding image selection',
  (url) => {
    const { hero, thumbnail } = renderBanner('TX', {
      backdrop_path: url,
      poster_path: url,
    });
    for (const image of [hero, thumbnail]) {
      expect(image).toHaveAttribute('src', url);
      expect(image).not.toHaveAttribute('srcset');
      expect(image).not.toHaveAttribute('sizes');
    }
  }
);

test('preserves Douban proxy selection and falls back after an image error', () => {
  localStorage.setItem('doubanImageProxyType', 'server');
  localStorage.setItem('doubanImageProxyTypeBackup', 'img3');
  const { hero, thumbnail } = renderBanner('Douban', {
    backdrop_path: 'https://img9.doubanio.com/view/photo/cover/public/p123.jpg',
    poster_path: 'https://img9.doubanio.com/view/photo/cover/public/p123.jpg',
  });
  for (const image of [hero, thumbnail]) {
    expect(image).toHaveAttribute(
      'src',
      '/api/image-proxy?url=https%3A%2F%2Fimg9.doubanio.com%2Fview%2Fphoto%2Fcover%2Fpublic%2Fp123.jpg'
    );
    expect(image).not.toHaveAttribute('srcset');
    fireEvent.error(image);
    expect(image).toHaveAttribute(
      'src',
      'https://img3.doubanio.com/view/photo/cover/public/p123.jpg'
    );
    expect(image).not.toHaveAttribute('srcset');
  }
});
