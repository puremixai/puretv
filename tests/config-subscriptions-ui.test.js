const React = require('react');
// History has its own API tests; keep these tests focused on subscription drafts.
jest.mock('../src/components/admin/ConfigHistory', () => ({ ConfigHistory: () => null }));
global.Headers = require('vm').runInThisContext('Headers');
const { TextEncoder } = require('util');
global.TextEncoder = TextEncoder;
global.structuredClone = (value) => JSON.parse(JSON.stringify(value));
const {
  render,
  screen,
  fireEvent,
  waitFor,
} = require('@testing-library/react');
const {
  ConfigFileComponent,
} = require('../src/components/admin/ConfigFileComponent');

const entry = (ID) => ({
  ID,
  Name: ID,
  URL: `https://example.com/${ID}`,
  Enabled: true,
  AutoUpdate: true,
  LastCheck: '',
});
const config = {
  ConfigFile: '{}',
  ConfigFileLocal: '{}',
  ConfigSubscriptions: [entry('a'), entry('b')],
};

beforeEach(() => {
  jest.spyOn(global.crypto, 'randomUUID').mockReturnValue('new-subscription');
});
afterEach(() => jest.restoreAllMocks());

test('edits multiple subscriptions and applies the complete list in one save', async () => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ success: true }),
  }));
  const refreshConfig = jest.fn(async () => {});
  render(React.createElement(ConfigFileComponent, { config, refreshConfig }));
  fireEvent.click(screen.getByRole('button', { name: '添加订阅' }));
  fireEvent.change(screen.getByLabelText('订阅 URL 3'), {
    target: { value: 'https://example.com/third' },
  });
  fireEvent.click(screen.getByLabelText('下移订阅 1'));
  fireEvent.click(screen.getByRole('button', { name: '保存并应用' }));
  await waitFor(() => expect(refreshConfig).toHaveBeenCalledTimes(1));
  const request = JSON.parse(global.fetch.mock.calls[0][1].body);
  expect(request.subscriptions.map((sub) => sub.ID)).toEqual([
    'b',
    'a',
    'new-subscription',
  ]);
  expect(request.configFile).toBe('{}');
});

test('single pull preserves the other subscription and requires save before applying', async () => {
  const updated = [entry('a'), { ...entry('b'), LastError: 'offline' }];
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      subscriptions: updated,
      sourceCount: 0,
      failedCount: 1,
    }),
  }));
  render(
    React.createElement(ConfigFileComponent, {
      config,
      refreshConfig: jest.fn(),
    })
  );
  fireEvent.click(screen.getAllByRole('button', { name: '单独拉取' })[1]);
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('更新失败')
  );
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(global.fetch.mock.calls[0][1].body).id).toBe('b');
  expect(screen.getByLabelText('订阅 URL 1').value).toBe(
    'https://example.com/a'
  );
});

test('changing a subscription address discards the old address cache before saving', async () => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ success: true }),
  }));
  render(
    React.createElement(ConfigFileComponent, {
      config: {
        ...config,
        ConfigSubscriptions: [
          {
            ...entry('a'),
            ConfigContent: '{"api_site":{}}',
            LastCheck: '2026-09-12T00:00:00.000Z',
          },
        ],
      },
      refreshConfig: jest.fn(),
    })
  );
  fireEvent.change(screen.getByLabelText('订阅 URL 1'), {
    target: { value: 'https://example.com/new' },
  });
  fireEvent.click(screen.getByRole('button', { name: '保存并应用' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  const savedEntry = JSON.parse(global.fetch.mock.calls[0][1].body)
    .subscriptions[0];
  expect(savedEntry.ConfigContent).toBeUndefined();
  expect(savedEntry.LastCheck).toBe('');
});


test('unsaved draft survives a concurrent reload and sends its original revision', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 409, clone: () => ({ json: async () => ({ error: '配置已更新，请刷新' }) }) }));
  const props = { config: { ...config, ConfigVersion: 7 }, refreshConfig: jest.fn() };
  const { rerender } = render(React.createElement(ConfigFileComponent, props));
  fireEvent.change(screen.getByLabelText('订阅名称 1'), { target: { value: 'unsaved name' } });
  rerender(React.createElement(ConfigFileComponent, { ...props, config: { ...config, ConfigVersion: 8 } }));
  expect(screen.getByLabelText('订阅名称 1').value).toBe('unsaved name');
  const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '保存并应用' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('配置已更新'));
  expect(global.fetch.mock.calls[0][1].headers.get('x-config-version')).toBe('7');
  expect(screen.getByLabelText('订阅名称 1').value).toBe('unsaved name');
});
