/** @jest-environment node */
require('./web-globals');
const { NextRequest } = require('next/server');
jest.mock('../src/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('../src/lib/logger', () => ({ logger: { error: jest.fn() } }));
jest.mock('../src/lib/session', () => ({
  getAuthenticatedUser: jest.fn(async () => ({ username: 'test-owner' })),
}));
jest.mock('../src/lib/permissions', () => ({
  hasFeaturePermission: jest.fn(async () => true),
}));
jest.mock('../src/lib/ai-orchestrator', () => ({
  orchestrateDataSources: jest.fn(),
}));
jest.mock('../src/lib/ai-tool-agent', () => ({
  buildAgentSystemPrompt: jest.fn(() => 'test system'),
  buildAgentTools: jest.fn(() => []),
  runToolAgent: jest.fn(async () => ({ kind: 'text', content: '测试回复' })),
}));
const { getConfig } = require('../src/lib/config');
const { resolveAIModelConfig } = require('../src/lib/ai-model-config');
const { generateAIComments } = require('../src/lib/ai-comment-generator');
const { POST: chat } = require('../src/app/api/ai/chat/route');
const { runToolAgent } = require('../src/lib/ai-tool-agent');

const openai = {
  Enabled: true,
  EnableAIComments: true,
  EnableNewMode: true,
  NewProtocol: 'openai-completions',
  Provider: 'custom',
  OpenAIApiKey: 'openai-test-key',
  OpenAIBaseURL: ' https://openai.example/v1/// ',
  OpenAIModel: 'openai-test-model',
  CustomApiKey: '',
  CustomBaseURL: '',
  CustomModel: '',
  Temperature: 0,
  MaxTokens: 256,
};
const legacy = {
  ...openai,
  EnableNewMode: false,
  CustomApiKey: 'legacy-test-key',
  CustomBaseURL: 'https://legacy.example/v1/',
  CustomModel: 'legacy-test-model',
};
const text = JSON.stringify([
  { content: '用于测试的 AI 评论', rating: 4, sentiment: 'positive' },
]);
const nativeFetch = global.fetch;
test.each(['openai-completions', 'openai-responses'])(
  'provider root URL gains /v1 for %s; gateway prefixes stay intact',
  (protocol) => {
    expect(
      resolveAIModelConfig({
        ...openai,
        NewProtocol: protocol,
        OpenAIBaseURL: ' https://gateway.example/// ',
      }).baseURL
    ).toBe('https://gateway.example/v1');
    expect(
      resolveAIModelConfig({
        ...openai,
        NewProtocol: protocol,
        OpenAIBaseURL: 'https://gateway.example/tenant/api/v2/',
      }).baseURL
    ).toBe('https://gateway.example/tenant/api/v2');
  }
);
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
  getConfig.mockResolvedValue({ AIConfig: openai });
});
afterEach(() => {
  global.fetch = nativeFetch;
});
const generate = (aiConfig = openai) =>
  generateAIComments({ movieName: '测试影片', count: 1, aiConfig });

test.each(['openai-completions', 'openai-responses', 'claude'])(
  'chat shares comment connection resolution for %s',
  async (protocol) => {
    const config = {
      ...openai,
      NewProtocol: protocol,
      ClaudeApiKey: 'claude-test-key',
      ClaudeBaseURL: 'https://claude.example/v1/',
      ClaudeModel: 'claude-test-model',
    };
    getConfig.mockResolvedValue({ AIConfig: config });
    const response = await chat(
      new NextRequest('http://localhost/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ message: '测试' }),
        headers: { 'content-type': 'application/json' },
      })
    );
    expect(response.status).toBe(200);
    expect(runToolAgent).toHaveBeenCalledWith(
      expect.objectContaining(resolveAIModelConfig(config))
    );
  }
);

test.each([
  [
    openai,
    'https://openai.example/v1/chat/completions',
    { choices: [{ message: { content: text } }] },
    'openai-test-key',
    'openai-test-model',
  ],
  [
    { ...openai, NewProtocol: 'openai-responses' },
    'https://openai.example/v1/responses',
    {
      output: [
        { type: 'reasoning', content: [] },
        { type: 'message', content: [{ type: 'output_text', text }] },
      ],
    },
    'openai-test-key',
    'openai-test-model',
  ],
  [
    {
      ...openai,
      NewProtocol: 'claude',
      ClaudeApiKey: 'claude-test-key',
      ClaudeBaseURL: 'https://claude.example/',
      ClaudeModel: 'claude-test-model',
    },
    'https://claude.example/v1/messages',
    {
      content: [
        { type: 'thinking', thinking: 'ignored' },
        { type: 'text', text },
      ],
    },
    'claude-test-key',
    'claude-test-model',
  ],
  [
    legacy,
    'https://legacy.example/v1/chat/completions',
    { choices: [{ message: { content: '```json\n' + text + '\n```' } }] },
    'legacy-test-key',
    'legacy-test-model',
  ],
])(
  'comments use the active connection and wire protocol %#',
  async (config, url, payload, key, model) => {
    getConfig.mockResolvedValue({ AIConfig: config });
    global.fetch.mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 })
    );
    const comments = await generate(config);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      content: '用于测试的 AI 评论',
      rating: 4,
      isAiGenerated: true,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [destination, options] = global.fetch.mock.calls[0];
    expect(destination).toBe(url);
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({ model, temperature: 0, stream: false });
    if (url.endsWith('/responses')) {
      expect(body).toMatchObject({
        max_output_tokens: 256,
        input: expect.any(String),
        instructions: expect.any(String),
      });
      expect(body.max_tokens).toBeUndefined();
    } else {
      expect(body.max_tokens).toBe(256);
      expect(body.messages.some((message) => message.role === 'user')).toBe(
        true
      );
    }
    if (url.endsWith('/messages')) {
      expect(options.headers).toMatchObject({
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      });
      expect(options.headers.Authorization).toBeUndefined();
      expect(body.system).toEqual(expect.any(String));
      expect(body.messages.every((message) => message.role !== 'system')).toBe(
        true
      );
    } else expect(options.headers.Authorization).toBe('Bearer ' + key);
    expect(options.signal).toBeDefined();
  }
);

test('legacy connection is a complete fallback only when the new connection is unset', () => {
  expect(
    resolveAIModelConfig({
      ...legacy,
      EnableNewMode: true,
      OpenAIApiKey: '',
      OpenAIBaseURL: '',
      OpenAIModel: '',
    })
  ).toMatchObject({ apiKey: 'legacy-test-key', model: 'legacy-test-model' });
  expect(() =>
    resolveAIModelConfig({ ...legacy, EnableNewMode: true, OpenAIApiKey: '' })
  ).toThrow('API Key');
  expect(
    resolveAIModelConfig({ ...openai, EnableNewMode: undefined })
  ).toMatchObject({ apiKey: 'openai-test-key' });
  expect(
    resolveAIModelConfig({
      ...openai,
      NewProtocol: 'claude',
      ClaudeApiKey: 'test-key',
      ClaudeModel: 'test-model',
    }).baseURL
  ).toBe('https://api.anthropic.com/v1');
});

test('missing active model gives an actionable error before any paid request', async () => {
  await expect(
    generate({
      ...openai,
      OpenAIModel: ' ',
      EnableWebSearch: true,
      TavilyApiKey: 'search-test-key',
    })
  ).rejects.toThrow('OpenAI缺少模型名称');
  expect(global.fetch).not.toHaveBeenCalled();
});

test.each([
  { choices: [] },
  { choices: [{ message: { content: 'not json' } }] },
  { choices: [{ message: { content: '[{}]' } }] },
])(
  'invalid provider response cannot appear as successful comments: %j',
  async (payload) => {
    global.fetch.mockResolvedValue(new Response(JSON.stringify(payload)));
    await expect(generate()).rejects.toThrow();
  }
);

test('upstream authentication errors are distinct from missing configuration and do not leak response contents', async () => {
  global.fetch.mockResolvedValue(
    new Response('private upstream detail', { status: 401 })
  );
  await expect(generate()).rejects.toThrow('AI API调用失败: 401');
});

test('HTML gateway landing page produces an actionable endpoint error', async () => {
  global.fetch.mockResolvedValue(
    new Response('<!doctype html><html>gateway</html>')
  );
  await expect(generate()).rejects.toThrow(
    'AI接口未返回有效JSON，请检查当前协议的 Base URL 是否正确'
  );
});
