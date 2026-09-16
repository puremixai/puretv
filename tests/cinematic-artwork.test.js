const React = require('react');
const { act, cleanup, fireEvent, render } = require('@testing-library/react');
const { renderToString } = require('react-dom/server.node');

// Keep ProxyImage real: this layer must preserve responsive images and fallbacks.
const CinematicArtwork =
  require('../src/components/hero/CinematicArtwork').default;

const originalFetch = global.fetch;
let context;
let getContext;

function artwork(props = {}) {
  const originalSrc = props.originalSrc || '/artwork/default.jpg';
  return React.createElement(CinematicArtwork, {
    originalSrc,
    displaySrc: originalSrc,
    alt: '精选影片画面',
    retryOnError: false,
    ...props,
  });
}

function loaded(image) {
  Object.defineProperties(image, {
    naturalWidth: { configurable: true, value: 1600 },
    naturalHeight: { configurable: true, value: 900 },
  });
  fireEvent.load(image);
}

beforeEach(() => {
  context = {
    drawImage: jest.fn(),
    getImageData: jest.fn(() => ({
      data: Uint8ClampedArray.from(
        Array.from({ length: 32 * 32 }, () => [180, 90, 30, 255]).flat(),
      ),
      width: 32,
      height: 32,
    })),
  };
  getContext = jest
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(context);
  global.fetch = jest.fn(() => {
    throw new Error('Artwork effects must reuse the loaded image');
  });
});

afterEach(() => {
  cleanup();
  expect(global.fetch).not.toHaveBeenCalled();
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

test('renders the initial image during SSR without sampling browser pixels', () => {
  const html = renderToString(artwork({ originalSrc: '/artwork/ssr.jpg' }));
  expect(html).toContain('src="/artwork/ssr.jpg"');
  expect(html).toContain('data-state="loading"');
  expect(getContext).not.toHaveBeenCalled();
});

test('preserves responsive selection and priority while exposing image readiness', () => {
  const onLoad = jest.fn();
  const { container, getByAltText } = render(
    artwork({
      originalSrc: '/artwork/responsive.jpg',
      srcSet: '/artwork/small.jpg 780w, /artwork/responsive.jpg 1280w',
      sizes: '100vw',
      loading: 'eager',
      fetchPriority: 'high',
      onLoad,
    }),
  );
  const host = container.querySelector('.cinematic-artwork');
  const image = getByAltText('精选影片画面');
  expect(host).toHaveAttribute('data-state', 'loading');
  expect(host).toHaveAttribute('data-active', 'true');
  expect(host).toHaveAttribute('data-paused', 'false');
  expect(image).toHaveAttribute(
    'srcset',
    '/artwork/small.jpg 780w, /artwork/responsive.jpg 1280w',
  );
  expect(image).toHaveAttribute('sizes', '100vw');
  expect(image).toHaveAttribute('loading', 'eager');
  expect(image.getAttribute('fetchpriority')).toBe('high');

  loaded(image);
  expect(host).toHaveAttribute('data-state', 'ready');
  expect(onLoad).toHaveBeenCalledTimes(1);
  expect(onLoad.mock.calls[0][0].target).toBe(image);
});

test('keeps the atmosphere host after an image failure and forwards the error', () => {
  const onError = jest.fn();
  const { container, getByAltText } = render(
    artwork({ originalSrc: '/artwork/broken.jpg', onError }),
  );
  const host = container.querySelector('.cinematic-artwork');
  const image = getByAltText('精选影片画面');
  const fallbackTone = host.style.getPropertyValue('--artwork-tone');
  fireEvent.error(image);
  expect(host).toBeInTheDocument();
  expect(host).toHaveAttribute('data-state', 'error');
  expect(onError).toHaveBeenCalledTimes(1);
  expect(host.style.getPropertyValue('--artwork-tone')).toBe(fallbackTone);

  // Proxy fallbacks or a later successful retry can recover the presentation.
  loaded(image);
  expect(host).toHaveAttribute('data-state', 'ready');
});

test.each(['load', 'error'])(
  'a late %s from the replaced source cannot affect the new image',
  (event) => {
    const onLoad = jest.fn();
    const onError = jest.fn();
    const view = render(
      artwork({ originalSrc: `/artwork/old-${event}.jpg`, onLoad, onError }),
    );
    const oldImage = view.getByAltText('精选影片画面');
    loaded(oldImage);
    onLoad.mockClear();
    view.rerender(
      artwork({ originalSrc: `/artwork/new-${event}.jpg`, onLoad, onError }),
    );
    let host = view.container.querySelector('.cinematic-artwork');
    expect(host).toHaveAttribute('data-state', 'loading');

    fireEvent[event](oldImage);
    host = view.container.querySelector('.cinematic-artwork');
    expect(host).toHaveAttribute('data-state', 'loading');
    expect(onLoad).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    loaded(view.getByAltText('精选影片画面'));
    expect(host).toHaveAttribute('data-state', 'ready');
  },
);

test('inactive and paused artwork keep their loaded image without restarting it', () => {
  const view = render(artwork({ originalSrc: '/artwork/pause.jpg' }));
  const image = view.getByAltText('精选影片画面');
  loaded(image);
  view.rerender(
    artwork({ originalSrc: '/artwork/pause.jpg', active: false, paused: true }),
  );
  const host = view.container.querySelector('.cinematic-artwork');
  expect(host).toHaveAttribute('data-state', 'ready');
  expect(host).toHaveAttribute('data-active', 'false');
  expect(host).toHaveAttribute('data-paused', 'true');
  expect(view.getByAltText('精选影片画面')).toBe(image);
});

test('samples an already loaded local image at a small size and reuses its cached color', () => {
  const view = render(artwork({ originalSrc: '/artwork/cached-color.jpg' }));
  const image = view.getByAltText('精选影片画面');
  const host = view.container.querySelector('.cinematic-artwork');
  const fallbackTone = host.style.getPropertyValue('--artwork-tone');
  loaded(image);
  const sampledTone = host.style.getPropertyValue('--artwork-tone');
  expect(sampledTone).not.toBe(fallbackTone);
  expect(context.drawImage).toHaveBeenCalledTimes(1);
  expect(context.drawImage.mock.calls[0][0]).toBe(image);
  const canvas = getContext.mock.instances[0];
  expect(canvas.width).toBeLessThanOrEqual(32);
  expect(canvas.height).toBeLessThanOrEqual(32);
  expect(canvas.width * canvas.height).toBeGreaterThan(0);
  expect(context.getImageData).toHaveBeenCalledTimes(1);
  view.unmount();

  const again = render(artwork({ originalSrc: '/artwork/cached-color.jpg' }));
  loaded(again.getByAltText('精选影片画面'));
  expect(again.container.querySelector('.cinematic-artwork')).toHaveAttribute(
    'data-state',
    'ready',
  );
  expect(context.drawImage).toHaveBeenCalledTimes(1);
  expect(
    again.container
      .querySelector('.cinematic-artwork')
      .style.getPropertyValue('--artwork-tone'),
  ).toBe(sampledTone);
});

test('a tainted canvas never prevents the loaded image from becoming ready', () => {
  context.getImageData.mockImplementation(() => {
    throw new DOMException('The canvas has been tainted', 'SecurityError');
  });
  const view = render(artwork({ originalSrc: '/artwork/redirected-cors.jpg' }));
  expect(() => loaded(view.getByAltText('精选影片画面'))).not.toThrow();
  expect(view.container.querySelector('.cinematic-artwork')).toHaveAttribute(
    'data-state',
    'ready',
  );
});

test('remote artwork becomes ready without a second request for color extraction', () => {
  context.getImageData.mockImplementation(() => {
    throw new DOMException('Cross-origin image', 'SecurityError');
  });
  const view = render(
    artwork({ originalSrc: 'https://pictures.example/remote.jpg' }),
  );
  loaded(view.getByAltText('精选影片画面'));
  expect(view.container.querySelector('.cinematic-artwork')).toHaveAttribute(
    'data-state',
    'ready',
  );
});

test('recognizes an image already loaded before hydration attaches its load handler', () => {
  jest
    .spyOn(HTMLImageElement.prototype, 'complete', 'get')
    .mockReturnValue(true);
  jest
    .spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get')
    .mockReturnValue(1280);
  jest
    .spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get')
    .mockReturnValue(720);
  const view = render(
    artwork({ originalSrc: '/artwork/cached-before-hydration.jpg' }),
  );
  expect(view.container.querySelector('.cinematic-artwork')).toHaveAttribute(
    'data-state',
    'ready',
  );
});

test('recovers when the browser returns to a previously loaded responsive candidate', () => {
  const view = render(
    artwork({ originalSrc: '/artwork/responsive-recovery.jpg' }),
  );
  const image = view.getByAltText('精选影片画面');
  const host = view.container.querySelector('.cinematic-artwork');
  loaded(image);
  expect(host).toHaveAttribute('data-state', 'ready');
  fireEvent.error(image);
  expect(host).toHaveAttribute('data-state', 'error');
  loaded(image);
  expect(host).toHaveAttribute('data-state', 'ready');
});

test('evicts old sampled colors instead of retaining every browsed image indefinitely', () => {
  const view = render(artwork({ originalSrc: '/artwork/evicted.jpg' }));
  loaded(view.getByAltText('精选影片画面'));
  // A long browsing session exceeds the small artwork cache; its exact capacity
  // is intentionally not part of this regression.
  for (let index = 0; index < 150; index++) {
    view.rerender(artwork({ originalSrc: `/artwork/eviction-${index}.jpg` }));
    loaded(view.getByAltText('精选影片画面'));
  }
  const samplesBeforeReturn = context.drawImage.mock.calls.length;
  view.rerender(artwork({ originalSrc: '/artwork/evicted.jpg' }));
  loaded(view.getByAltText('精选影片画面'));
  expect(context.drawImage).toHaveBeenCalledTimes(samplesBeforeReturn + 1);
});

test('pauses artwork outside the viewport and disconnects its observer on unmount', () => {
  const originalObserver = global.IntersectionObserver;
  let notify;
  const disconnect = jest.fn();
  global.IntersectionObserver = jest.fn((callback) => {
    notify = callback;
    return { observe: jest.fn(), disconnect };
  });
  try {
    const view = render(
      artwork({ originalSrc: '/artwork/outside-viewport.jpg' }),
    );
    const host = view.container.querySelector('.cinematic-artwork');
    act(() => notify([{ isIntersecting: false, target: host }]));
    expect(host).toHaveAttribute('data-paused', 'true');
    act(() => notify([{ isIntersecting: true, target: host }]));
    expect(host).toHaveAttribute('data-paused', 'false');
    view.unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  } finally {
    global.IntersectionObserver = originalObserver;
  }
});
