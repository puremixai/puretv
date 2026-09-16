/** @jest-environment node */
require('./web-globals');
const { NextRequest } = require('next/server');
jest.mock('../src/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('../src/lib/session', () => ({ getAuthenticatedUser: jest.fn() }));
jest.mock('../src/lib/server/ai-comments', () => ({
  enqueueAIComments: jest.fn(),
  readSavedAIComments: jest.fn(),
  runAICommentJob: jest.fn(),
}));
const { getConfig } = require('../src/lib/config');
const { getAuthenticatedUser } = require('../src/lib/session');
const jobs = require('../src/lib/server/ai-comments');
const { GET, POST } = require('../src/app/api/ai-comments/route');
const { POST: worker } = require('../src/app/api/ai-comments/worker/route');
const { AIConfigurationError } = require('../src/lib/ai-model-config');
const movie = { name: '测试影片', year: '2024', count: 10, info: '' };
const request = (body) =>
  new NextRequest(
    'http://localhost/api/ai-comments?name=测试影片&year=2024',
    body
      ? {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        }
      : {}
  );
beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_STORAGE_TYPE = 'postgres';
  getAuthenticatedUser.mockResolvedValue({ username: 'alice', role: 'admin' });
  getConfig.mockResolvedValue({
    AIConfig: { Enabled: true, EnableAIComments: true },
  });
  jobs.readSavedAIComments.mockResolvedValue({
    status: 'completed',
    comments: [{ content: 'saved' }],
  });
  jobs.enqueueAIComments.mockResolvedValue({
    status: 'queued',
    jobId: 'job-1',
    comments: [],
  });
});
test('GET loads shared saved comments and never starts generation', async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(jobs.readSavedAIComments).toHaveBeenCalledWith(movie);
  expect((await response.json()).canGenerate).toBe(true);
  expect(jobs.enqueueAIComments).not.toHaveBeenCalled();
});
test('POST returns a durable job immediately and regeneration is explicit', async () => {
  expect((await POST(request(movie))).status).toBe(202);
  expect(jobs.enqueueAIComments).toHaveBeenCalledWith('alice', movie, false);
  expect((await POST(request({ ...movie, regenerate: true }))).status).toBe(
    202
  );
  expect(jobs.enqueueAIComments).toHaveBeenLastCalledWith('alice', movie, true);
});
test('existing completed results can be returned without new work', async () => {
  jobs.enqueueAIComments.mockResolvedValue({
    status: 'completed',
    comments: [{ content: 'saved' }],
  });
  expect((await POST(request(movie))).status).toBe(200);
});
test.each(['get', 'post'])('authentication protects %s', async (method) => {
  const handler = method === 'get' ? GET : POST;
  getAuthenticatedUser.mockResolvedValue(null);
  expect(
    (await handler(request(method === 'post' ? movie : undefined))).status
  ).toBe(401);
  expect(jobs.readSavedAIComments).not.toHaveBeenCalled();
  expect(jobs.enqueueAIComments).not.toHaveBeenCalled();
});

test.each([false, true])(
  'ordinary users cannot generate even with regenerate=%s',
  async (regenerate) => {
    getAuthenticatedUser.mockResolvedValue({
      username: 'viewer',
      role: 'user',
    });
    const response = await POST(request({ ...movie, regenerate }));
    expect(response.status).toBe(403);
    expect((await response.json()).canGenerate).toBe(false);
    expect(jobs.enqueueAIComments).not.toHaveBeenCalled();
  }
);

test('all authenticated viewers can read administrator comments without AI-ask permission or task details', async () => {
  getAuthenticatedUser.mockResolvedValue({ username: 'viewer', role: 'user' });
  jobs.readSavedAIComments.mockResolvedValue({
    status: 'failed',
    comments: [{ content: 'shared' }],
    total: 1,
    movieName: movie.name,
    jobId: 'private-job',
    generationId: 'private-generation',
    error: 'provider error',
  });
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    status: 'failed',
    comments: [{ content: 'shared' }],
    total: 1,
    movieName: movie.name,
    isAiGenerated: true,
    canGenerate: false,
  });
  expect(jobs.readSavedAIComments).toHaveBeenCalledWith(movie);
  expect(jobs.enqueueAIComments).not.toHaveBeenCalled();
});

test.each(['admin', 'owner'])('%s can generate comments', async (role) => {
  getAuthenticatedUser.mockResolvedValue({ username: 'manager', role });
  const response = await POST(request(movie));
  expect(response.status).toBe(202);
  expect((await response.json()).canGenerate).toBe(true);
});
test.each([{ Enabled: false }, { EnableAIComments: false }])(
  'feature switches protect persisted comments: %j',
  async (override) => {
    getConfig.mockResolvedValue({
      AIConfig: { Enabled: true, EnableAIComments: true, ...override },
    });
    expect((await GET(request())).status).toBe(403);
    expect((await POST(request(movie))).status).toBe(403);
  }
);
test.each([
  'name=影片&count=NaN',
  'name=影片&count=1.5',
  'name=影片&count=0',
  'name=影片&count=51',
  'name=影片&count=1abc',
  'count=1',
])('invalid movie request rejected: %s', async (query) => {
  expect(
    (await GET(new NextRequest('http://localhost/api/ai-comments?' + query)))
      .status
  ).toBe(400);
  expect(jobs.readSavedAIComments).not.toHaveBeenCalled();
});
test('missing configuration and queue limits have actionable status codes', async () => {
  jobs.enqueueAIComments.mockRejectedValueOnce(
    new AIConfigurationError('OpenAI', ['API Key'])
  );
  expect((await POST(request(movie))).status).toBe(400);
  jobs.enqueueAIComments.mockRejectedValueOnce(
    Object.assign(new Error('queue full'), { code: 'AI_QUEUE_FULL' })
  );
  expect((await POST(request(movie))).status).toBe(429);
});
test('a browser session cannot invoke the internal worker', async () => {
  const response = await worker(
    new NextRequest('http://localhost/api/ai-comments/worker', {
      method: 'POST',
      headers: { 'x-ai-worker-token': 'forged' },
    })
  );
  expect(response.status).toBe(401);
  expect(jobs.runAICommentJob).not.toHaveBeenCalled();
});

test('cross-origin submission cannot start a paid task', async () => {
  const response = await POST(
    new NextRequest('http://localhost/api/ai-comments', {
      method: 'POST',
      headers: {
        origin: 'https://unrelated.example',
        'content-type': 'application/json',
      },
      body: JSON.stringify(movie),
    })
  );
  expect(response.status).toBe(403);
  expect(jobs.enqueueAIComments).not.toHaveBeenCalled();
});

test.each([
  [{ host: '127.0.0.1:59848', origin: 'http://127.0.0.1:59848' }, 202],
  [
    {
      host: 'puretv.example',
      origin: 'https://puretv.example',
      'x-forwarded-proto': 'https',
    },
    202,
  ],
  [{ host: '127.0.0.1:59848', origin: 'http://127.0.0.1:59849' }, 403],
  [
    {
      host: 'puretv.example',
      origin: 'http://puretv.example',
      'sec-fetch-site': 'cross-site',
    },
    403,
  ],
])(
  'browser-facing origin is checked behind Docker and proxies: %j',
  async (headers, status) => {
    const response = await POST(
      new NextRequest('http://0.0.0.0:3000/api/ai-comments', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(movie),
      })
    );
    expect(response.status).toBe(status);
    expect(jobs.enqueueAIComments).toHaveBeenCalledTimes(
      status === 202 ? 1 : 0
    );
  }
);
