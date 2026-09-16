const React = require('react');
const { act, cleanup, fireEvent, render } = require('@testing-library/react');

const PwaRegistration = require('../src/components/PwaRegistration').default;

const originalServiceWorker = Object.getOwnPropertyDescriptor(
  navigator,
  'serviceWorker'
);
const originalReadyState = Object.getOwnPropertyDescriptor(
  document,
  'readyState'
);
const originalPath = window.location.pathname;
let readyState;
let register;
let unregister;

beforeEach(() => {
  readyState = 'loading';
  unregister = jest.fn().mockResolvedValue(true);
  const registration = { unregister };
  register = jest.fn().mockResolvedValue(registration);
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      register,
      getRegistrations: jest.fn().mockResolvedValue([registration]),
    },
  });
  Object.defineProperty(document, 'readyState', {
    configurable: true,
    get: () => readyState,
  });
  window.history.replaceState({}, '', '/play/deep/route');
});

afterEach(() => {
  cleanup();
  expect(unregister).not.toHaveBeenCalled();
  jest.restoreAllMocks();
  if (originalServiceWorker) {
    Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker);
  } else {
    delete navigator.serviceWorker;
  }
  if (originalReadyState) {
    Object.defineProperty(document, 'readyState', originalReadyState);
  } else {
    delete document.readyState;
  }
  window.history.replaceState({}, '', originalPath);
});

test('waits for window load and registers the root worker once, even from a deep route', () => {
  render(React.createElement(PwaRegistration));
  expect(register).not.toHaveBeenCalled();

  fireEvent.load(window);
  fireEvent.load(window);

  expect(register).toHaveBeenCalledTimes(1);
  expect(register).toHaveBeenCalledWith('/sw.js', {
    scope: '/',
    updateViaCache: 'none',
  });
});

test('registers immediately when loading already completed, including localhost', () => {
  readyState = 'complete';
  expect(window.location.hostname).toBe('localhost');
  render(React.createElement(PwaRegistration));

  expect(register).toHaveBeenCalledWith('/sw.js', {
    scope: '/',
    updateViaCache: 'none',
  });
});

test.each(['/puretv/', '/puretv'])(
  'registers the worker inside the absolute directory scope %s',
  (scope) => {
    readyState = 'complete';
    render(React.createElement(PwaRegistration, { scope }));

    expect(register).toHaveBeenCalledWith('/puretv/sw.js', {
      scope: '/puretv/',
      updateViaCache: 'none',
    });
  }
);

test('leaves existing registrations alone when disabled', () => {
  readyState = 'complete';
  render(React.createElement(PwaRegistration, { enabled: false }));
  fireEvent.load(window);
  expect(register).not.toHaveBeenCalled();
});

test('does nothing when the browser has no service-worker support', () => {
  delete navigator.serviceWorker;
  readyState = 'complete';
  render(React.createElement(PwaRegistration));
  fireEvent.load(window);
  expect(register).not.toHaveBeenCalled();
});

test('unmounting cancels a registration waiting for window load', () => {
  const view = render(React.createElement(PwaRegistration));
  view.unmount();
  fireEvent.load(window);
  expect(register).not.toHaveBeenCalled();
});

test('disabling cancels a pending load listener and enabling after load registers', () => {
  const view = render(React.createElement(PwaRegistration));
  view.rerender(React.createElement(PwaRegistration, { enabled: false }));
  readyState = 'complete';
  fireEvent.load(window);
  expect(register).not.toHaveBeenCalled();

  view.rerender(React.createElement(PwaRegistration, { enabled: true }));
  expect(register).toHaveBeenCalledTimes(1);
});

test('a scope change replaces the pending registration instead of registering both', () => {
  const view = render(React.createElement(PwaRegistration));
  view.rerender(React.createElement(PwaRegistration, { scope: '/puretv/' }));
  fireEvent.load(window);

  expect(register).toHaveBeenCalledTimes(1);
  expect(register).toHaveBeenCalledWith('/puretv/sw.js', {
    scope: '/puretv/',
    updateViaCache: 'none',
  });
});

test.each([
  'puretv/',
  '../',
  'https://other.example/puretv/',
  '//other.example/puretv/',
  '/\\other.example/puretv/',
  '/puretv/?version=1',
  '/puretv/#fragment',
  '/puretv/%2f/',
  '/puretv/%5C/',
  '/puretv/../',
  '/puretv/%2e%2e/',
])('does not register an invalid or non-rooted scope %s', (scope) => {
  readyState = 'complete';
  render(React.createElement(PwaRegistration, { scope }));
  fireEvent.load(window);
  expect(register).not.toHaveBeenCalled();
});

test.each(['rejected promise', 'synchronous exception'])(
  'reports a registration %s without an unhandled error',
  async (failure) => {
    const error = new Error('registration unavailable');
    if (failure === 'rejected promise') {
      register.mockRejectedValue(error);
    } else {
      register.mockImplementation(() => {
        throw error;
      });
    }
    const errorOutput = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    readyState = 'complete';

    await act(async () => {
      render(React.createElement(PwaRegistration));
    });

    expect(register).toHaveBeenCalledTimes(1);
    expect(errorOutput).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ message: 'registration unavailable' })
    );
  }
);
