const React = require('react');
const { render, screen, fireEvent, act } = require('@testing-library/react');

// Keep the update behavior independent of the repository's next version bump.
jest.mock('../src/lib/version', () => ({ CURRENT_VERSION: '0.1.0-dev.2' }));
jest.mock('../src/lib/changelog', () => ({
  changelog: [
    {
      version: '0.1.0-dev.2',
      date: '2026-09-13',
      added: [],
      changed: ['本地开发版本'],
      fixed: [],
    },
  ],
}));

const { CURRENT_VERSION } = require('../src/lib/version');
const {
  checkForUpdates,
  compareVersions,
  fetchRemoteChangelog,
  UpdateStatus,
} = require('../src/lib/version_check');
const { VersionPanel } = require('../src/components/VersionPanel');

const originalFetch = global.fetch;
const changelogUrl =
  'https://raw.githubusercontent.com/puremixai/puretv/main/CHANGELOG';
const release = (version) =>
  `# PureTV\n\n## [${version}] - 2026-09-13\n### Changed\n- PureTV 界面更新\n`;
const response = (body, ok = true) => ({
  ok,
  status: ok ? 200 : 404,
  statusText: ok ? 'OK' : 'Not Found',
  text: async () => body,
});

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

test('checks the PureTV release feed rather than an upstream release with a larger number', async () => {
  global.fetch = jest.fn(async (url) =>
    response(
      String(url).split('?')[0] === changelogUrl
        ? release(CURRENT_VERSION)
        : '999.0.0',
    ),
  );
  expect(await checkForUpdates()).toBe(UpdateStatus.NO_UPDATE);
});

test('recognizes a newer release from the PureTV changelog', async () => {
  global.fetch = jest.fn(async () => response(release('999.0.0')));
  expect(await checkForUpdates()).toBe(UpdateStatus.HAS_UPDATE);
});

test.each([
  '# OpenTV\n\n## [999.0.0] - 2026-09-13\n### Added\n- 旧品牌版本\n',
  '# MoonTVPlus\n\n## [999.0.0] - 2026-09-13\n### Added\n- 上游版本\n',
  '## [999.0.0] - 2026-09-13\n### Added\n- 上游版本\n',
  '# PureTV\n\n尚无发布记录',
  '# PureTV\n\n## [1..0] - 2026-09-13\n### Changed\n- 无效版本\n',
])(
  'rejects an unbranded or malformed feed instead of advertising an update: %s',
  async (body) => {
    global.fetch = jest.fn(async () => response(body));
    expect(await checkForUpdates()).toBe(UpdateStatus.FETCH_FAILED);
  },
);

test('reports an unavailable PureTV feed as a failed check', async () => {
  global.fetch = jest.fn(async () => response('Not Found', false));
  expect(await checkForUpdates()).toBe(UpdateStatus.FETCH_FAILED);
});

test.each([
  '<!doctype html>',
  '',
  '1',
  '1.0',
  '1..0',
  '999.0.0.1',
  '01.0.0',
  '0.1.0-dev.01',
  '0.1.0-dev..1',
  '0.1.0-',
  '0.1.0+',
  '0.1.0+build..1',
  'v0.1.0',
])('does not treat invalid version data as a new release: %s', (version) =>
  expect(compareVersions(version)).toBe(UpdateStatus.FETCH_FAILED),
);

test.each([
  ['0.1.0-dev.1', UpdateStatus.NO_UPDATE],
  ['0.1.0-dev.2', UpdateStatus.NO_UPDATE],
  ['0.1.0-dev.10', UpdateStatus.HAS_UPDATE],
  ['0.1.0', UpdateStatus.HAS_UPDATE],
  ['0.1.0-dev.2+build.123', UpdateStatus.NO_UPDATE],
  ['0.1.0-dev.10+build.001', UpdateStatus.HAS_UPDATE],
  ['0.0.9', UpdateStatus.NO_UPDATE],
  ['0.2.0-dev.1', UpdateStatus.HAS_UPDATE],
  ['999.0.0-preview', UpdateStatus.HAS_UPDATE],
])(
  'compares %s against the installed development build',
  (version, expected) => {
    expect(compareVersions(version)).toBe(expected);
  },
);

test('accepts prerelease notes with build metadata from the PureTV feed', async () => {
  global.fetch = jest.fn(async () =>
    response(release('0.1.0-dev.10+build.001')),
  );
  expect(await fetchRemoteChangelog()).toEqual([
    {
      version: '0.1.0-dev.10+build.001',
      date: '2026-09-13',
      added: [],
      changed: ['PureTV 界面更新'],
      fixed: [],
    },
  ]);
  expect(await checkForUpdates()).toBe(UpdateStatus.HAS_UPDATE);
});

test.each(['0.1.0-dev.01', '0.1.0-dev..1', '01.0.0', '0.1.0+'])(
  'rejects a malformed version in a branded feed: %s',
  async (version) => {
    global.fetch = jest.fn(async () => response(release(version)));
    expect(await checkForUpdates()).toBe(UpdateStatus.FETCH_FAILED);
  },
);

test('the panel shows the installed PureTV version and the current repository', async () => {
  global.fetch = jest.fn(async () => response(release(CURRENT_VERSION)));
  render(
    React.createElement(VersionPanel, { isOpen: true, onClose: jest.fn() }),
  );
  expect(await screen.findByText('未发现新版本')).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { name: 'PureTV 版本信息' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '前往 PureTV 仓库' })).toHaveAttribute(
    'href',
    'https://github.com/puremixai/puretv',
  );
  expect(
    screen.getByText(`当前安装 PureTV v${CURRENT_VERSION}`),
  ).toBeInTheDocument();
});

test('a failed panel check never claims the installed version is latest', async () => {
  global.fetch = jest.fn(async () => response('Not Found', false));
  render(
    React.createElement(VersionPanel, { isOpen: true, onClose: jest.fn() }),
  );
  expect(await screen.findByText('暂时无法检查更新')).toBeInTheDocument();
  expect(screen.queryByText('未发现新版本')).not.toBeInTheDocument();
  expect(screen.queryByText('当前为最新版本')).not.toBeInTheDocument();
});

test('the panel distinguishes a pending check from a confirmed result', async () => {
  let finish;
  global.fetch = jest.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(
    React.createElement(VersionPanel, { isOpen: true, onClose: jest.fn() }),
  );
  expect(screen.getByText('正在检查 PureTV 更新')).toBeInTheDocument();
  expect(screen.queryByText('当前为最新版本')).not.toBeInTheDocument();
  await act(async () => finish(response(release(CURRENT_VERSION))));
  expect(screen.getByText('未发现新版本')).toBeInTheDocument();
});

test('the panel displays newer PureTV release notes and links to the PureTV repository', async () => {
  global.fetch = jest.fn(async () => response(release('999.0.0')));
  render(
    React.createElement(VersionPanel, { isOpen: true, onClose: jest.fn() }),
  );
  expect(await screen.findByText('发现新版本')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '查看更新内容' }));
  expect(screen.getByText('PureTV 界面更新')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '前往 PureTV 仓库' })).toHaveAttribute(
    'href',
    'https://github.com/puremixai/puretv',
  );
});

test('the panel displays a newer development build and its release notes', async () => {
  global.fetch = jest.fn(async () => response(release('0.1.0-dev.10')));
  render(
    React.createElement(VersionPanel, { isOpen: true, onClose: jest.fn() }),
  );
  expect(await screen.findByText('发现新版本')).toBeInTheDocument();
  expect(screen.getByText('v0.1.0-dev.2 → v0.1.0-dev.10')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '查看更新内容' }));
  expect(
    screen.getByRole('heading', { name: 'v0.1.0-dev.10' }),
  ).toBeInTheDocument();
  expect(screen.getByText('PureTV 界面更新')).toBeInTheDocument();
});

test('a reopened panel ignores an older pending response', async () => {
  const pending = [];
  global.fetch = jest.fn(() => new Promise((resolve) => pending.push(resolve)));
  const props = { isOpen: true, onClose: jest.fn() };
  const panel = render(React.createElement(VersionPanel, props));
  panel.rerender(
    React.createElement(VersionPanel, { ...props, isOpen: false }),
  );
  panel.rerender(React.createElement(VersionPanel, props));
  await act(async () => pending[1](response(release('0.1.0-dev.10'))));
  expect(screen.getByText('发现新版本')).toBeInTheDocument();
  await act(async () => pending[0](response(release(CURRENT_VERSION))));
  expect(screen.getByText('发现新版本')).toBeInTheDocument();
  expect(screen.getByText('v0.1.0-dev.2 → v0.1.0-dev.10')).toBeInTheDocument();
});
