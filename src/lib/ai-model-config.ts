import type { AdminConfig } from '@/lib/admin.types';
import { normalizeApiBaseUrl } from '@/lib/url';

export type AIProtocol = 'openai-completions' | 'openai-responses' | 'claude';
export type AISettings = NonNullable<AdminConfig['AIConfig']>;

export class AIConfigurationError extends Error {
  constructor(provider: string, fields: string[]) {
    super(
      `AI配置不完整：${provider}缺少${fields.join(
        '、'
      )}，请在管理面板的 AI 设置中补全`
    );
    this.name = 'AIConfigurationError';
  }
}

// Chat and comments must use the same active protocol and credentials.
export function resolveAIModelConfig(config: AISettings) {
  const newMode = config.EnableNewMode ?? true;
  const protocol: AIProtocol =
    newMode &&
    (config.NewProtocol === 'claude' ||
      config.NewProtocol === 'openai-responses')
      ? config.NewProtocol
      : 'openai-completions';
  let apiKey: string;
  let baseURL: string;
  let model: string;
  let provider: string;
  if (protocol === 'claude') {
    provider = 'Claude';
    apiKey = config.ClaudeApiKey?.trim() || '';
    baseURL =
      normalizeApiBaseUrl(config.ClaudeBaseURL) || 'https://api.anthropic.com';
    if (!/\/v1$/i.test(baseURL)) baseURL += '/v1';
    model = config.ClaudeModel?.trim() || '';
  } else {
    // Old installations can keep using their custom connection when the new
    // OpenAI connection is entirely unset. Never mix credentials across endpoints.
    const useOpenAI =
      newMode &&
      Boolean(
        config.OpenAIApiKey?.trim() ||
          config.OpenAIBaseURL?.trim() ||
          config.OpenAIModel?.trim()
      );
    provider = useOpenAI ? 'OpenAI' : '自定义 API';
    apiKey =
      (useOpenAI ? config.OpenAIApiKey : config.CustomApiKey)?.trim() || '';
    baseURL = normalizeApiBaseUrl(
      useOpenAI ? config.OpenAIBaseURL : config.CustomBaseURL
    );
    // The panel accepts a provider root URL; OpenAI-compatible endpoints live
    // under /v1. Keep explicitly configured paths (gateway/Azure prefixes).
    if (/^https?:\/\/[^/?#]+$/i.test(baseURL)) baseURL += '/v1';
    model = (useOpenAI ? config.OpenAIModel : config.CustomModel)?.trim() || '';
  }
  const missing = [
    !apiKey && 'API Key',
    !baseURL && 'Base URL',
    !model && '模型名称',
  ].filter((value): value is string => Boolean(value));
  if (missing.length) throw new AIConfigurationError(provider, missing);
  return { protocol, apiKey, baseURL, model };
}
