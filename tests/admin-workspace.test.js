const React = require('react');
const {
  render,
  screen,
  fireEvent,
  cleanup,
} = require('@testing-library/react');
const {
  visibleAdminSections,
  filterAdminSections,
} = require('../src/components/admin/navigation');
const { filterVideoSources } = require('../src/components/admin/source-list');
const { AdminPanel } = require('../src/components/admin/AdminPanel');
const {
  useUnsavedChanges,
  confirmDiscardChanges,
} = require('../src/hooks/useUnsavedChanges');

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

test('admin navigation excludes owner-only destinations and can find settings by related terms', () => {
  const admin = visibleAdminSections('admin');
  expect(admin.map((item) => item.id)).not.toEqual(
    expect.arrayContaining(['configFile', 'dataMigration', 'maintenance'])
  );
  expect(filterAdminSections(admin, 'TMDB').map((item) => item.id)).toEqual([
    'siteConfig',
  ]);
  expect(
    filterAdminSections(visibleAdminSections('owner'), '回滚').map(
      (item) => item.id
    )
  ).toEqual(['configFile']);
  expect(filterAdminSections(admin, '没有这种功能')).toEqual([]);
});

test('source search combines names, keys and URLs with status without changing the source list', () => {
  const sources = [
    { key: 'a', name: '电影', api: 'https://one.example/api' },
    {
      key: 'Backup',
      name: '电影备用',
      api: 'https://two.example/api',
      disabled: true,
    },
    { key: 'c', name: '动漫', api: 'https://three.example/api' },
  ];
  expect(
    filterVideoSources(sources, '电影', 'enabled').map((s) => s.key)
  ).toEqual(['a']);
  expect(
    filterVideoSources(sources, ' BACKUP ', 'disabled').map((s) => s.key)
  ).toEqual(['Backup']);
  expect(
    filterVideoSources(sources, 'three.example', 'all').map((s) => s.key)
  ).toEqual(['c']);
  expect(sources).toHaveLength(3);
});

test('filtering does not dirty a panel, but editing a setting guards navigation until a saved revision arrives', () => {
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  const content = React.createElement(
    'div',
    null,
    React.createElement('input', {
      type: 'search',
      'aria-label': '搜索视频源',
    }),
    React.createElement('input', { 'aria-label': '站点名称' })
  );
  const view = render(React.createElement(AdminPanel, { version: 1 }, content));
  fireEvent.change(screen.getByLabelText('搜索视频源'), {
    target: { value: '电影' },
  });
  expect(confirmDiscardChanges()).toBe(true);
  fireEvent.change(screen.getByLabelText('站点名称'), {
    target: { value: '新的名称' },
  });
  expect(confirmDiscardChanges()).toBe(false);
  expect(confirm).toHaveBeenCalledTimes(1);
  view.rerender(React.createElement(AdminPanel, { version: 2 }, content));
  expect(confirmDiscardChanges()).toBe(true);
});

test('nested dirty guards prompt only once for a link', () => {
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
  function Dirty() {
    useUnsavedChanges(true);
    return null;
  }
  render(
    React.createElement(
      'div',
      null,
      React.createElement(Dirty),
      React.createElement(Dirty),
      React.createElement(
        'a',
        { href: '/somewhere', onClick: (event) => event.preventDefault() },
        '离开'
      )
    )
  );
  fireEvent.click(screen.getByText('离开'));
  expect(confirm).toHaveBeenCalledTimes(1);
});
