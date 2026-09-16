/* global afterEach, beforeEach, expect, jest, test */
import { cleanup, render, waitFor } from '@testing-library/react';
import { useRouter, useSearchParams } from 'next/navigation';
import React from 'react';

import TVLivePlayPage from '../src/app/tv/live/play/page';
import TVNativeVideo from '../src/components/tv/player/TVNativeVideo';
import { isFavorited } from '../src/lib/db.client';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}));
jest.mock('../src/lib/db.client', () => ({
  isFavorited: jest.fn(),
  saveFavorite: jest.fn(),
  deleteFavorite: jest.fn(),
}));
// Keep the real page and playback resolver; only replace the media engine.
jest.mock('../src/components/tv/player/TVNativeVideo', () => ({
  __esModule: true,
  default: jest.fn(() => null),
}));
jest.mock('../src/components/tv/TVVirtualRemote', () => ({
  __esModule: true,
  default: () => null,
}));

const originalFetch = global.fetch;
const sourceKey = 'news & sports';
const channelId = 'selected-channel';
const channelName = 'Selected sports channel';
const channelTvgId = 'sports & news';

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  useRouter.mockReturnValue({ replace: jest.fn(), back: jest.fn() });
  useSearchParams.mockReturnValue(
    new URLSearchParams({ source: sourceKey, id: channelId }),
  );
  isFavorited.mockResolvedValue(false);
});

afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

async function playChannel(rawUrl, proxyMode) {
  const selectedSource = { key: sourceKey, name: 'Selected source' };
  // An absent field represents an existing source without a saved mode.
  if (proxyMode !== undefined) selectedSource.proxyMode = proxyMode;
  const channelsUrl = `/api/live/channels?source=${encodeURIComponent(sourceKey)}`;
  const epgUrl = `/api/live/epg?source=${encodeURIComponent(sourceKey)}&tvgId=${encodeURIComponent(channelTvgId)}`;
  const responses = new Map([
    [
      '/api/live/sources',
      [
        { key: 'unselected-source', name: 'Other source', proxyMode: 'full' },
        selectedSource,
      ],
    ],
    [
      channelsUrl,
      [
        { id: 'unselected-channel', name: 'Other channel', url: 'https://cdn.example/other.mp4' },
        { id: channelId, name: channelName, tvgId: channelTvgId, url: rawUrl },
      ],
    ],
    [epgUrl, { programs: [] }],
  ]);
  global.fetch = jest.fn(async (url) => {
    if (!responses.has(url)) throw new Error(`Unexpected request: ${url}`);
    return { ok: true, status: 200, json: async () => ({ data: responses.get(url) }) };
  });

  render(React.createElement(TVLivePlayPage));

  await waitFor(() => expect(TVNativeVideo).toHaveBeenCalled());
  // Both query-selected source and channel must survive the API -> player path.
  expect(isFavorited).toHaveBeenCalledWith(`live_${sourceKey}`, `live_${channelId}`);
  expect(global.fetch.mock.calls.map(([url]) => url)).toEqual([
    '/api/live/sources',
    channelsUrl,
    epgUrl,
  ]);
  const props = TVNativeVideo.mock.calls.at(-1)[0];
  expect(props).toMatchObject({ live: true, title: channelName });
  return props;
}

test('a TV source without a saved mode passes its signed HLS URL directly to the player', async () => {
  const url = 'https://cdn.example/live.M3U8?token=a%2Fb%2Bc&expires=12';
  expect(await playChannel(url)).toMatchObject({ url, sourceType: 'm3u8' });
});

test.each(['full', 'm3u8-only'])(
  'the TV player preserves the explicitly selected %s HLS mode',
  async (mode) => {
    const rawUrl = 'https://cdn.example/live.m3u8?token=a%2Fb%2Bc&expires=12';
    const props = await playChannel(rawUrl, mode);
    const playbackUrl = new URL(props.url, 'https://puretv.example');
    expect(props.sourceType).toBe('m3u8');
    expect(playbackUrl.pathname).toBe('/api/proxy/m3u8');
    expect(playbackUrl.searchParams.get('url')).toBe(rawUrl);
    expect(playbackUrl.searchParams.get('puretv-source')).toBe(sourceKey);
    expect(playbackUrl.searchParams.get('allowCORS')).toBe(
      mode === 'm3u8-only' ? 'true' : null,
    );
  },
);

test.each([
  ['flv', 'flv', undefined],
  ['mp4', 'native', undefined],
  ['flv', 'flv', 'full'],
  ['mp4', 'native', 'm3u8-only'],
])(
  'TV %s playback uses the %s engine with mode %s and keeps the stream direct',
  async (extension, sourceType, mode) => {
    const url = `https://cdn.example/live.${extension}?token=a%2Fb&next=playlist.m3u8`;
    expect(await playChannel(url, mode)).toMatchObject({ url, sourceType });
  },
);
