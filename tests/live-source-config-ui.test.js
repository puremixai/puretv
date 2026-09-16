/* global afterEach, beforeEach, expect, jest, test */
import { runInThisContext } from 'node:vm';
import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { LiveSourceConfig } from '../src/components/admin/LiveSourceConfig';

global.Headers = runInThisContext('Headers');

const source = (key, proxyMode) => ({
  key,
  name: key,
  url: `https://example.com/${key}.m3u`,
  from: 'custom',
  proxyMode,
});

function renderSources(sources, refreshConfig = jest.fn(async () => {})) {
  render(
    React.createElement(LiveSourceConfig, {
      config: { LiveConfig: sources },
      refreshConfig,
    }),
  );
  return refreshConfig;
}

function sourceMode(key) {
  return within(screen.getByRole('row', { name: new RegExp(key) })).getByRole(
    'combobox',
  );
}

function fillNewSource(key) {
  fireEvent.change(screen.getByPlaceholderText('名称'), {
    target: { value: key },
  });
  fireEvent.change(screen.getByPlaceholderText('Key'), {
    target: { value: key },
  });
  fireEvent.change(screen.getByPlaceholderText('M3U 地址'), {
    target: { value: `https://example.com/${key}.m3u` },
  });
}

beforeEach(() => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200 }));
});

afterEach(() => jest.restoreAllMocks());

test('drag-and-drop accessibility elements stay outside the table', () => {
  renderSources([source('legacy', undefined)]);
  expect(screen.getByRole('table').querySelector('div')).toBeNull();
  expect(screen.getByRole('status')).toBeInTheDocument();
});

test('missing and unrecognized modes display direct first as the default', () => {
  renderSources([
    source('legacy', undefined),
    source('empty', null),
    source('unknown', 'old-mode'),
  ]);

  for (const key of ['legacy', 'empty', 'unknown']) {
    const select = sourceMode(key);
    expect(select).toHaveValue('direct');
    expect(within(select).getAllByRole('option')[0]).toHaveTextContent(
      '直连（默认）',
    );
  }
  expect(screen.getByText(/直连.*不转发视频/)).toBeVisible();
  expect(global.fetch).not.toHaveBeenCalled();
});

test.each(['full', 'm3u8-only', 'direct'])(
  'an explicit %s mode remains selected',
  (mode) => {
    renderSources([source('configured', mode)]);
    expect(sourceMode('configured')).toHaveValue(mode);
    expect(global.fetch).not.toHaveBeenCalled();
  },
);

test('changing modes sends the selected mode and keeps it after refresh', async () => {
  const refreshConfig = renderSources([source('configured', 'full')]);

  for (const [index, mode] of ['m3u8-only', 'direct'].entries()) {
    fireEvent.change(sourceMode('configured'), { target: { value: mode } });
    await waitFor(() => expect(refreshConfig).toHaveBeenCalledTimes(index + 1));
    expect(sourceMode('configured')).toHaveValue(mode);
    expect(sourceMode('configured')).not.toBeDisabled();
    const [url, request] = global.fetch.mock.calls[index];
    expect(url).toBe('/api/admin/live');
    expect(request.method).toBe('POST');
    expect(JSON.parse(request.body)).toEqual({
      action: 'set_proxy_mode',
      key: 'configured',
      proxyMode: mode,
    });
  }
});

test.each([undefined, 'full', 'm3u8-only'])(
  'a failed mode change restores %s and re-enables the selector',
  async (originalMode) => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    let reply;
    global.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
    );
    const refreshConfig = renderSources([source('configured', originalMode)]);
    const nextMode = originalMode === undefined ? 'full' : 'direct';

    fireEvent.change(sourceMode('configured'), {
      target: { value: nextMode },
    });
    expect(sourceMode('configured')).toHaveValue(nextMode);
    expect(sourceMode('configured')).toBeDisabled();
    await act(async () => reply({ ok: false, status: 500 }));

    expect(sourceMode('configured')).toHaveValue(originalMode || 'direct');
    expect(sourceMode('configured')).not.toBeDisabled();
    expect(screen.getByText('设置代理模式失败')).toBeVisible();
    expect(refreshConfig).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledTimes(1);
  },
);

test('new sources submit direct by default', async () => {
  const refreshConfig = renderSources([]);
  fireEvent.click(screen.getByRole('button', { name: '添加直播源' }));
  expect(screen.getByRole('combobox')).toHaveValue('direct');
  fillNewSource('new-direct');
  fireEvent.click(screen.getByRole('button', { name: '添加', exact: true }));

  await waitFor(() => expect(refreshConfig).toHaveBeenCalledTimes(1));
  expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toMatchObject({
    action: 'add',
    key: 'new-direct',
    proxyMode: 'direct',
  });
});

test.each(['full', 'm3u8-only'])(
  'a new explicit %s mode is submitted and the next form resets to direct',
  async (mode) => {
    const refreshConfig = renderSources([]);
    fireEvent.click(screen.getByRole('button', { name: '添加直播源' }));
    fillNewSource('new-proxy');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: mode } });
    fireEvent.click(screen.getByRole('button', { name: '添加', exact: true }));

    await waitFor(() => expect(refreshConfig).toHaveBeenCalledTimes(1));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toMatchObject({
      action: 'add',
      key: 'new-proxy',
      proxyMode: mode,
    });
    fireEvent.click(screen.getByRole('button', { name: '添加直播源' }));
    expect(screen.getByRole('combobox')).toHaveValue('direct');
    expect(screen.getByPlaceholderText('名称')).toHaveValue('');
  },
);
