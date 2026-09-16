const React = require('react');
const {
  render,
  screen,
  fireEvent,
  renderHook,
  cleanup,
} = require('@testing-library/react');
jest.mock('../src/hooks/useSavedAIComments', () => ({
  useSavedAIComments: jest.fn(),
}));
const { useSavedAIComments } = require('../src/hooks/useSavedAIComments');
const AIComments = require('../src/components/AIComments').default;
const { useEnableAIComments } = require('../src/hooks/useEnableAIComments');
const comments = [
  {
    id: '1',
    content: '管理员已保存的影评',
    userName: 'AI 影评',
    userAvatar: '/avatar.png',
    rating: 4,
    votes: 0,
    isAiGenerated: true,
  },
];
const originalRuntime = window.RUNTIME_CONFIG;
beforeEach(() => jest.clearAllMocks());
afterEach(() => {
  cleanup();
  window.RUNTIME_CONFIG = originalRuntime;
});

test.each(['idle', 'queued', 'running', 'failed', 'completed'])(
  'ordinary viewers only see comments in %s state',
  (status) => {
    useSavedAIComments.mockReturnValue({
      job: { status, comments },
      canGenerate: false,
      restoring: false,
      loading: ['queued', 'running'].includes(status),
      error: status === 'failed' ? 'provider failure' : null,
    });
    render(React.createElement(AIComments, { movieName: '电影' }));
    expect(screen.getByText('管理员已保存的影评')).toBeInTheDocument();
    expect(screen.getByText('AI生成')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/provider failure|新评论正在生成/)
    ).not.toBeInTheDocument();
  }
);

test.each(['idle', 'queued', 'failed'])(
  'an empty %s state does not invite viewers to generate comments',
  (status) => {
    useSavedAIComments.mockReturnValue({
      job: { status, comments: [] },
      canGenerate: false,
      restoring: false,
      loading: status === 'queued',
      error: status === 'failed' ? 'provider failure' : null,
    });
    render(React.createElement(AIComments, { movieName: '电影' }));
    expect(screen.getByText('暂无评论')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  }
);

test.each([
  ['idle', '生成AI评论', 'start'],
  ['failed', '重试生成', 'start'],
  ['completed', '重新生成', 'regenerate'],
])('administrators retain %s controls', (status, label, action) => {
  const start = jest.fn(),
    regenerate = jest.fn();
  useSavedAIComments.mockReturnValue({
    job: { status, comments: status === 'completed' ? comments : [] },
    canGenerate: true,
    restoring: false,
    loading: false,
    error: status === 'failed' ? '生成失败' : null,
    start,
    regenerate,
  });
  render(React.createElement(AIComments, { movieName: '电影' }));
  fireEvent.click(screen.getByRole('button', { name: label }));
  expect(action === 'start' ? start : regenerate).toHaveBeenCalledTimes(1);
});

test('comment visibility is independent of permission to ask AI', () => {
  window.RUNTIME_CONFIG = { AI_ENABLED: false, AI_COMMENTS_ENABLED: true };
  const hook = renderHook(() => useEnableAIComments());
  expect(hook.result.current).toBe(true);
});
