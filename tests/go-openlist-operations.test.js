/** @jest-environment node */
require('./web-globals');
jest.mock('../src/lib/server/go-worker', () => ({
  isGoWorkerEnabled: jest.fn(() => true),
  requestWorker: jest.fn(),
}));
const {
  requestWorker,
  isGoWorkerEnabled,
} = require('../src/lib/server/go-worker');
const { OpenListClient } = require('../src/lib/openlist.client');
const originalFetch = global.fetch;
beforeEach(() => {
  jest.clearAllMocks();
  isGoWorkerEnabled.mockReturnValue(true);
  global.fetch = jest.fn();
  requestWorker.mockResolvedValue(
    Response.json({ code: 200, data: { content: [], total: 0 } }),
  );
});
afterEach(() => {
  global.fetch = originalFetch;
});
test('Go client lists without any Node upstream login and preserves parameters', async () => {
  const client = new OpenListClient(
    'https://list.example/prefix/',
    'user',
    'password',
  );
  const result = await client.listDirectory('/电影', 2, 30, true);
  expect(result.data.total).toBe(0);
  expect(global.fetch).not.toHaveBeenCalled();
  const [path, init] = requestWorker.mock.calls[0];
  expect(path).toBe('/v1/openlist/operations');
  expect(JSON.parse(init.body)).toMatchObject({
    url: 'https://list.example/prefix',
    username: 'user',
    path: '/api/fs/list',
    method: 'POST',
  });
  expect(JSON.parse(JSON.parse(init.body).body)).toEqual({
    path: '/电影',
    password: '',
    refresh: true,
    page: 2,
    per_page: 30,
  });
});
test('Go transport failure never falls back to Node', async () => {
  requestWorker.mockRejectedValue(new Error('private upstream error'));
  await expect(
    new OpenListClient('https://list.example', 'u', 'p').getFile('/test'),
  ).rejects.toThrow('Go OpenList 服务不可用');
  expect(global.fetch).not.toHaveBeenCalled();
});
