/** @jest-environment node */
require('./web-globals');
jest.mock('../src/lib/db', () => ({ db: { getGlobalValue: jest.fn(), setGlobalValue: jest.fn() } }));
jest.mock('../src/lib/server/public-fetch', () => ({ fetchPublicUrl: jest.fn(), readLimitedText: async response => response.text() }));
const { fetchPublicUrl } = require('../src/lib/server/public-fetch');
const { probeMedia } = require('../src/lib/server/source-health');
const { effectiveSourceWeight, updateHealth } = require('../src/lib/source-health');
const { redactLogValue } = require('../src/lib/logger');
afterEach(() => jest.clearAllMocks());
test('three continuous failures lower priority; recovery removes the failure penalty', () => {
  let health;
  for (let i = 0; i < 3; i++) health = updateHealth(health, { api: 'https://source.example', checkedAt: Date.now(), status: 'invalid', latencyMs: 100 });
  expect(health.consecutiveFailures).toBe(3); expect(effectiveSourceWeight(10, health)).toBe(-50);
  health = updateHealth(health, { ...health, status: 'valid' }); expect(health.consecutiveFailures).toBe(0); expect(effectiveSourceWeight(10, health)).toBe(10);
  expect(updateHealth(health, { ...health, status: 'no_results' }).consecutiveFailures).toBe(0);
});
test('play probe follows a playlist to actual segment bytes and rejects HTML masquerading as video', async () => {
  fetchPublicUrl.mockResolvedValueOnce(new Response('#EXTM3U\n#EXTINF:10,\nclip.ts')).mockResolvedValueOnce(new Response(Uint8Array.from([0x47, ...Array(187).fill(0)])));
  await probeMedia('https://example.com/test/index.m3u8', new AbortController().signal);
  expect(fetchPublicUrl.mock.calls[1][0]).toBe('https://example.com/test/clip.ts');
  fetchPublicUrl.mockResolvedValue(new Response('<html>blocked</html>'));
  await expect(probeMedia('https://example.com/clip.ts', new AbortController().signal)).rejects.toThrow('媒体');
});
test('log boundary redacts credentials without mutating the supplied object', () => {
  const input = { Cookie: 'session-secret', nested: { token: 'abc', url: 'https://u:p@example.com/a?token=abc' } };
  const result = redactLogValue(input); expect(JSON.stringify(result)).not.toContain('abc'); expect(result.Cookie).toBe('[redacted]'); expect(input.nested.token).toBe('abc');
});
