const React = require('react');
const { render, screen, fireEvent, act } = require('@testing-library/react');
let mockPath = '/';
jest.mock('next/navigation', () => ({
  usePathname: () => mockPath,
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock('../src/components/SiteProvider', () => ({
  useSite: () => ({ siteName: 'Test site' }),
}));
jest.mock('../src/components/WatchRoomProvider', () => ({
  useWatchRoomContextSafe: () => null,
}));
jest.mock('../src/components/UserMenu', () => ({
  UserMenu: () => React.createElement('button', null, '个人设置'),
}));
const Sidebar = require('../src/components/Sidebar').default;
const MobileBottomNav = require('../src/components/MobileBottomNav').default;
const { EmailSettingsPanel } = require('../src/components/EmailSettingsPanel');
const { AlertModal } = require('../src/components/admin/shared');

test.each([
  ['desktop', Sidebar],
  ['mobile', MobileBottomNav],
])(
  '%s navigation can enter and leave screen sharing without changing Hook order',
  (_, Component) => {
    mockPath = '/';
    const view = render(React.createElement(Component));
    expect(view.container.textContent).toContain('首页');
    mockPath = '/watch-room/screen';
    view.rerender(React.createElement(Component));
    expect(view.container).toBeEmptyDOMElement();
    mockPath = '/';
    view.rerender(React.createElement(Component));
    expect(view.container.textContent).toContain('首页');
  }
);

test('notification settings can repeatedly open and close', () => {
  const props = { mounted: true, userEmail: '', onClose: jest.fn() };
  const view = render(
    React.createElement(EmailSettingsPanel, { ...props, isOpen: false })
  );
  view.rerender(
    React.createElement(EmailSettingsPanel, { ...props, isOpen: true })
  );
  expect(screen.getAllByText(/邮箱|邮件/).length).toBeGreaterThan(0);
  view.rerender(
    React.createElement(EmailSettingsPanel, { ...props, isOpen: false })
  );
  view.rerender(
    React.createElement(EmailSettingsPanel, { ...props, isOpen: true })
  );
});

test('extracted admin modal confirms actions and cleans up its close timer', () => {
  jest.useFakeTimers();
  const onClose = jest.fn(),
    onConfirm = jest.fn();
  const props = {
    isOpen: true,
    type: 'warning',
    title: '确认操作',
    showConfirm: true,
    onClose,
    onConfirm,
    timer: 2000,
  };
  const view = render(React.createElement(AlertModal, props));
  fireEvent.click(screen.getByText('确定'));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  view.unmount();
  act(() => jest.advanceTimersByTime(3000));
  expect(onClose).not.toHaveBeenCalled();
  jest.useRealTimers();
});
