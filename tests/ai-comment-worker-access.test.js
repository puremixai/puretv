/** @jest-environment node */
jest.mock('../src/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('../src/lib/db', () => ({ db: { getUserInfoV2: jest.fn() } }));
jest.mock('../src/lib/ai-comment-generator', () => ({
  generateAIComments: jest.fn(),
}));
jest.mock('../src/lib/ai-model-config', () => ({
  resolveAIModelConfig: jest.fn(),
  AIConfigurationError: class extends Error {},
}));
jest.mock('../src/lib/cache-backend', () => ({
  readCache: jest.fn(),
  writeCache: jest.fn(),
}));
jest.mock('../server/ai-comments-store', () => ({
  createAICommentsStore: jest.fn(),
}));
const { getConfig } = require('../src/lib/config');
const { db } = require('../src/lib/db');
const { generateAIComments } = require('../src/lib/ai-comment-generator');
const { resolveAIModelConfig } = require('../src/lib/ai-model-config');
const { createAICommentsStore } = require('../server/ai-comments-store');
const {
  runAICommentJob,
  readSavedAIComments,
  aiCommentMovieKey,
} = require('../src/lib/server/ai-comments');
let store;
beforeEach(() => {
  jest.clearAllMocks();
  store = {
    claim: jest
      .fn()
      .mockResolvedValue({
        id: 'job',
        username: 'manager',
        movie_name: '电影',
        movie_year: '2024',
        movie_info: '',
        requested_count: 10,
        lease_token: 'lease',
      }),
    complete: jest.fn().mockResolvedValue({ result_revision: 1 }),
    fail: jest.fn(),
    get: jest.fn(),
    getResult: jest.fn(),
  };
  createAICommentsStore.mockReturnValue(store);
  getConfig.mockResolvedValue({
    AIConfig: { Enabled: true, EnableAIComments: true },
  });
  generateAIComments.mockResolvedValue([
    { id: 'saved', content: '影评', isAiGenerated: true },
  ]);
  resolveAIModelConfig.mockReturnValue({ model: 'mock', protocol: 'mock' });
});

test.each([
  { role: 'user', banned: false },
  { role: 'admin', banned: true },
  null,
])(
  'a revoked, banned, or deleted submitter cannot run a queued paid task: %j',
  async (user) => {
    db.getUserInfoV2.mockResolvedValue(user);
    expect(await runAICommentJob()).toBe(true);
    expect(db.getUserInfoV2).toHaveBeenCalledWith('manager', true);
    expect(generateAIComments).not.toHaveBeenCalled();
    expect(store.complete).not.toHaveBeenCalled();
    expect(store.fail).toHaveBeenCalledWith(
      'job',
      'lease',
      'AI评论生成权限已关闭'
    );
  }
);

test.each(['admin', 'owner'])(
  '%s jobs generate using mocked AI and persist the result',
  async (role) => {
    db.getUserInfoV2.mockResolvedValue({ role, banned: false });
    await runAICommentJob();
    expect(generateAIComments).toHaveBeenCalledTimes(1);
    expect(store.complete).toHaveBeenCalledTimes(1);
  }
);

test('published comments survive removal of their submitter without starting a job', async () => {
  const movie = { name: '电影', year: '2024', info: '', count: 10 };
  store.get.mockResolvedValue({
    id: 'shared',
    username: null,
    status: 'completed',
    result_revision: 1,
    movie_name: '电影',
  });
  store.getResult.mockResolvedValue([
    { content: '保留的管理员影评', isAiGenerated: true },
  ]);
  const saved = await readSavedAIComments(movie);
  expect(store.get).toHaveBeenCalledWith(aiCommentMovieKey(movie));
  expect(saved.comments[0].content).toBe('保留的管理员影评');
  expect(db.getUserInfoV2).not.toHaveBeenCalled();
  expect(generateAIComments).not.toHaveBeenCalled();
});
