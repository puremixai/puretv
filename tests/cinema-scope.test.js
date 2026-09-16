const React = require('react');
const { render, screen, fireEvent } = require('@testing-library/react');

let mockPath = '/search';
jest.mock('next/navigation', () => ({ usePathname: () => mockPath }));
const CinematicScope = require('../src/components/CinematicScope').default;
const { createCinemaPortal } = require('../src/components/CinemaPortal');

function Panel({ onClick }) {
  return createCinemaPortal(
    React.createElement('button', { onClick }, '收藏影片'),
    document.body
  );
}

afterEach(() => {
  document.documentElement.className = '';
});

test('front-end portals inherit cinema styling and keep their actions', () => {
  mockPath = '/search';
  document.documentElement.className = 'light';
  const onClick = jest.fn();
  const view = render(
    React.createElement(
      CinematicScope,
      null,
      React.createElement(Panel, { onClick })
    )
  );
  const button = screen.getByRole('button', { name: '收藏影片' });
  expect(button.closest('.cinema-portal')).toHaveClass('dark');
  fireEvent.click(button);
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(document.documentElement).toHaveClass('light');
  expect(document.body.dataset.cinemaUi).toBe('true');
  view.unmount();
  expect(document.body.dataset.cinemaUi).toBeUndefined();
});

test.each(['/admin', '/admin/settings'])(
  'admin %s keeps its own theme, including portals',
  (path) => {
    mockPath = path;
    const view = render(
      React.createElement(CinematicScope, null, React.createElement(Panel))
    );
    expect(view.container.querySelector('.cinema-ui')).toBeNull();
    expect(screen.getByRole('button').closest('.cinema-portal')).toBeNull();
    expect(document.body.dataset.cinemaUi).toBeUndefined();
  }
);

test.each(['/books/read', '/manga/read'])(
  'reader %s preserves paper and dialog themes',
  (path) => {
    mockPath = path;
    const view = render(
      React.createElement(CinematicScope, null, React.createElement(Panel))
    );
    expect(view.container.querySelector('.cinema-reading')).not.toHaveClass(
      'dark'
    );
    expect(screen.getByRole('button').closest('.cinema-portal')).toBeNull();
    expect(document.body.dataset.cinemaUi).toBe('reading');
  }
);

test('client navigation into admin removes the front-end scope without modifying saved theme', () => {
  mockPath = '/';
  document.documentElement.className = 'light';
  const view = render(
    React.createElement(CinematicScope, null, React.createElement(Panel))
  );
  mockPath = '/admin';
  view.rerender(
    React.createElement(CinematicScope, null, React.createElement(Panel))
  );
  expect(document.querySelector('.cinema-ui')).toBeNull();
  expect(document.body.dataset.cinemaUi).toBeUndefined();
  expect(document.documentElement).toHaveClass('light');
});
