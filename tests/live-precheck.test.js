/** @jest-environment node */
require('./web-globals');
const { NextRequest } = require('next/server');
jest.mock('../src/lib/permissions', () => ({
  requireFeaturePermission: jest.fn(async () => ({ username: 'viewer' })),
}));
jest.mock('../src/lib/config', () => ({
  getConfig: jest.fn(async () => ({
    LiveConfig: [{ key: 'news', ua: 'Example Player' }],
  })),
}));
const { GET } = require('../src/app/api/live/precheck/route');
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

test.each([
  'https://cdn.example/channel?sig=a%2Fb%26c%2Bz',
  'https://cdn.example/channel?sig=literal%25value',
])(
  'format probe preserves upstream signed URL %s and stops reading the body',
  async (raw) => {
    const cancel = jest.fn();
    global.fetch = jest.fn(async () => ({
      ok: true,
      headers: new Headers({ 'Content-Type': 'application/vnd.apple.mpegurl' }),
      url: raw,
      body: { cancel },
    }));
    const params = new URLSearchParams({ url: raw, 'puretv-source': 'news' });
    const response = await GET(
      new NextRequest(`https://puretv.example/api/live/precheck?${params}`),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, type: 'm3u8' });
    expect(global.fetch).toHaveBeenCalledWith(
      raw,
      expect.objectContaining({ headers: { 'User-Agent': 'Example Player' } }),
    );
    expect(cancel).toHaveBeenCalledTimes(1);
  },
);
