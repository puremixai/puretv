const React = require('react');
const {
  render,
  screen,
  fireEvent,
  cleanup,
} = require('@testing-library/react');
const RouteError = require('../src/components/RouteError').default;

afterEach(cleanup);

test('a failed route can retry and return to the homepage without exposing internal errors', () => {
  let retries = 0;
  render(
    React.createElement(RouteError, {
      reset: () => {
        retries++;
      },
    })
  );
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
  expect(retries).toBe(1);
  expect(screen.getByRole('link', { name: '返回首页' })).toHaveAttribute(
    'href',
    '/'
  );
  expect(screen.getByRole('alert')).toHaveTextContent('暂时无法加载');
});
