/** @jest-environment node */
require('./web-globals');

jest.mock('../server/health', () => ({ getHealth: jest.fn() }));
const { getHealth } = require('../server/health');
const { GET } = require('../src/app/api/health/route');
const {
  unstable_doesMiddlewareMatch,
} = require('next/experimental/testing/server');
const { config } = require('../src/middleware');

test.each([
  [{ status: 'ok' }, 200],
  [{ status: 'degraded', database: 'ok', cache: 'unavailable' }, 200],
  [{ status: 'unavailable', database: 'unavailable' }, 503],
])(
  'standalone readiness maps %j to %i without caching',
  async (health, status) => {
    getHealth.mockResolvedValueOnce(health);
    const response = await GET();
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(health);
    expect(response.headers.get('cache-control')).toBe('no-store');
  },
);

test('only the exact health endpoint bypasses browser authentication', () => {
  for (const path of ['/api/health', '/api/health/']) {
    expect(
      unstable_doesMiddlewareMatch({
        config,
        url: 'https://site.example' + path,
      }),
    ).toBe(false);
  }
  for (const path of ['/api/health-admin', '/api/health/private']) {
    expect(
      unstable_doesMiddlewareMatch({
        config,
        url: 'https://site.example' + path,
      }),
    ).toBe(true);
  }
});
