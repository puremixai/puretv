const React = require('react');
const { act, cleanup, fireEvent, render } = require('@testing-library/react');

const { useHeroParallax } = require('../src/components/hero/useHeroParallax');

const originalMatchMedia = window.matchMedia;
const originalRaf = window.requestAnimationFrame;
const originalCancelRaf = window.cancelAnimationFrame;
const originalHidden = Object.getOwnPropertyDescriptor(document, 'hidden');
const originalScrollY = Object.getOwnPropertyDescriptor(window, 'scrollY');
let media;
let frames;
let nextFrame;
let hidden;
let scrollY;

function Harness({ enabled, useContainer = false }) {
  const hostRef = React.useRef(null);
  const scrollRef = React.useRef(null);
  useHeroParallax(hostRef, {
    enabled,
    scrollRef: useContainer ? scrollRef : undefined,
  });
  // jsdom has no layout; model the visible hero moving with the document.
  React.useLayoutEffect(() => {
    hostRef.current.getBoundingClientRect = () => ({
      top: useContainer ? 0 : -scrollY,
      bottom: 600 - (useContainer ? 0 : scrollY),
      height: 600,
      width: 1200,
      left: 0,
      right: 1200,
    });
  }, [useContainer]);
  return React.createElement(
    'div',
    { ref: scrollRef, 'data-testid': 'scroller' },
    React.createElement('div', { ref: hostRef, 'data-testid': 'hero' }),
  );
}

function flushFrame() {
  const pending = [...frames.entries()];
  frames.clear();
  act(() => pending.forEach(([, callback]) => callback(100)));
}

function offset(host) {
  return (
    Number.parseFloat(host.style.getPropertyValue('--hero-parallax-y')) || 0
  );
}

function scrollWindow(value) {
  scrollY = value;
  fireEvent.scroll(window);
}

function setMedia(kind, matches) {
  act(() => {
    for (const [query, item] of media) {
      if (!query.includes(kind)) continue;
      item.matches = matches;
      for (const listener of item.listeners)
        listener({ matches, media: query });
    }
  });
}

function setHidden(value) {
  hidden = value;
  fireEvent(document, new Event('visibilitychange'));
}

beforeEach(() => {
  media = new Map();
  frames = new Map();
  nextFrame = 0;
  hidden = false;
  scrollY = 0;
  window.matchMedia = jest.fn((query) => {
    if (!media.has(query)) {
      const listeners = new Set();
      media.set(query, {
        matches: false,
        media: query,
        listeners,
        addEventListener: (_type, listener) => listeners.add(listener),
        removeEventListener: (_type, listener) => listeners.delete(listener),
        addListener: (listener) => listeners.add(listener),
        removeListener: (listener) => listeners.delete(listener),
      });
    }
    return media.get(query);
  });
  window.requestAnimationFrame = jest.fn((callback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  });
  window.cancelAnimationFrame = jest.fn((id) => frames.delete(id));
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden,
  });
  Object.defineProperty(window, 'scrollY', {
    configurable: true,
    get: () => scrollY,
  });
});

afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
  window.requestAnimationFrame = originalRaf;
  window.cancelAnimationFrame = originalCancelRaf;
  if (originalHidden) Object.defineProperty(document, 'hidden', originalHidden);
  else delete document.hidden;
  Object.defineProperty(window, 'scrollY', originalScrollY);
  jest.restoreAllMocks();
});

test('batches a window scroll burst into one frame and uses the latest position', () => {
  const view = render(React.createElement(Harness));
  const host = view.getByTestId('hero');
  flushFrame();
  expect(offset(host)).toBe(0);
  scrollWindow(20);
  scrollWindow(90);
  scrollWindow(160);
  expect(frames.size).toBe(1);
  expect(offset(host)).toBe(0);
  flushFrame();
  const firstOffset = offset(host);
  expect(Number.isFinite(firstOffset)).toBe(true);
  expect(Math.abs(firstOffset)).toBeGreaterThan(0);

  scrollWindow(160);
  flushFrame();
  expect(offset(host)).toBe(firstOffset);
  scrollWindow(0);
  flushFrame();
  expect(offset(host)).toBe(0);
});

test('uses the supplied panel scroll container independently from window scrolling', () => {
  const view = render(React.createElement(Harness, { useContainer: true }));
  const host = view.getByTestId('hero');
  const scroller = view.getByTestId('scroller');
  flushFrame();
  scrollWindow(300);
  flushFrame();
  expect(offset(host)).toBe(0);

  scroller.scrollTop = 180;
  fireEvent.scroll(scroller);
  flushFrame();
  expect(Math.abs(offset(host))).toBeGreaterThan(0);
  scroller.scrollTop = 0;
  fireEvent.scroll(scroller);
  flushFrame();
  expect(offset(host)).toBe(0);
});

test.each(['prefers-reduced-motion', 'pointer: coarse'])(
  'does no parallax work when %s is requested at mount',
  (query) => {
    const match = window.matchMedia(`(${query})`);
    match.matches = true;
    // Match the full reduced-motion query as well as the coarse-pointer query.
    if (query === 'prefers-reduced-motion') {
      window.matchMedia('(prefers-reduced-motion: reduce)').matches = true;
    }
    const view = render(React.createElement(Harness));
    const host = view.getByTestId('hero');
    flushFrame();
    scrollWindow(180);
    expect(frames.size).toBe(0);
    expect(offset(host)).toBe(0);
  },
);

test.each(['prefers-reduced-motion', 'pointer: coarse'])(
  'responds to %s changes and cancels an already queued frame',
  (preference) => {
    const view = render(React.createElement(Harness));
    const host = view.getByTestId('hero');
    flushFrame();
    scrollWindow(100);
    expect(frames.size).toBe(1);
    setMedia(preference, true);
    expect(frames.size).toBe(0);
    expect(offset(host)).toBe(0);
    scrollWindow(240);
    expect(frames.size).toBe(0);

    setMedia(preference, false);
    flushFrame();
    expect(Math.abs(offset(host))).toBeGreaterThan(0);
  },
);

test('stops queued work while hidden and catches up when the page is visible', () => {
  const view = render(React.createElement(Harness));
  const host = view.getByTestId('hero');
  flushFrame();
  scrollWindow(120);
  setHidden(true);
  expect(frames.size).toBe(0);
  const hiddenOffset = offset(host);
  scrollWindow(280);
  expect(frames.size).toBe(0);
  expect(offset(host)).toBe(hiddenOffset);
  setHidden(false);
  flushFrame();
  expect(Math.abs(offset(host))).toBeGreaterThan(0);
});

test('disabling the host clears its transform and prevents further scroll work', () => {
  const view = render(React.createElement(Harness, { enabled: true }));
  const host = view.getByTestId('hero');
  flushFrame();
  scrollWindow(180);
  flushFrame();
  expect(Math.abs(offset(host))).toBeGreaterThan(0);
  view.rerender(React.createElement(Harness, { enabled: false }));
  expect(frames.size).toBe(0);
  expect(offset(host)).toBe(0);
  scrollWindow(320);
  expect(frames.size).toBe(0);
});

test.each([false, true])(
  'unmount removes scroll, visibility, media listeners and pending work (container=%s)',
  (useContainer) => {
    const addWindow = jest.spyOn(window, 'addEventListener');
    const removeWindow = jest.spyOn(window, 'removeEventListener');
    const addDocument = jest.spyOn(document, 'addEventListener');
    const removeDocument = jest.spyOn(document, 'removeEventListener');
    const view = render(React.createElement(Harness, { useContainer }));
    const host = view.getByTestId('hero');
    const scroller = view.getByTestId('scroller');
    flushFrame();
    if (useContainer) {
      scroller.scrollTop = 100;
      fireEvent.scroll(scroller);
    } else scrollWindow(100);
    expect(frames.size).toBe(1);
    view.unmount();
    expect(frames.size).toBe(0);
    const valueAfterUnmount = offset(host);
    scrollWindow(500);
    expect(frames.size).toBe(0);
    fireEvent.scroll(scroller);
    expect(frames.size).toBe(0);
    setHidden(true);
    setMedia('prefers-reduced-motion', true);
    expect(frames.size).toBe(0);
    expect(offset(host)).toBe(valueAfterUnmount);
    for (const item of media.values()) expect(item.listeners.size).toBe(0);
    for (const [type, listener] of addWindow.mock.calls.filter(([type]) =>
      ['scroll', 'resize'].includes(type),
    )) {
      expect(
        removeWindow.mock.calls.some(
          (call) => call[0] === type && call[1] === listener,
        ),
      ).toBe(true);
    }
    for (const [type, listener] of addDocument.mock.calls.filter(
      ([type]) => type === 'visibilitychange',
    )) {
      expect(
        removeDocument.mock.calls.some(
          (call) => call[0] === type && call[1] === listener,
        ),
      ).toBe(true);
    }
  },
);

test('mounting in a hidden tab does not schedule animation until the tab is visible', () => {
  hidden = true;
  scrollY = 180;
  const view = render(React.createElement(Harness));
  expect(frames.size).toBe(0);
  expect(offset(view.getByTestId('hero'))).toBe(0);
  setHidden(false);
  flushFrame();
  expect(Math.abs(offset(view.getByTestId('hero')))).toBeGreaterThan(0);
});

test('switching from window to panel scrolling stops the former scroll source', () => {
  const view = render(React.createElement(Harness));
  flushFrame();
  scrollWindow(180);
  flushFrame();
  view.rerender(React.createElement(Harness, { useContainer: true }));
  flushFrame();
  const scroller = view.getByTestId('scroller');
  const host = view.getByTestId('hero');
  scroller.scrollTop = 100;
  fireEvent.scroll(scroller);
  flushFrame();
  const panelOffset = offset(host);
  expect(Math.abs(panelOffset)).toBeGreaterThan(0);
  scrollWindow(450);
  expect(frames.size).toBe(0);
  expect(offset(host)).toBe(panelOffset);
});
