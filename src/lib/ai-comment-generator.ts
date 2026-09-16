// AI评论生成核心逻辑

import { parseStringPromise } from 'xml2js';

import type { AIComment } from '@/lib/ai-comments.types';
import { AISettings, resolveAIModelConfig } from '@/lib/ai-model-config';
import { logger } from '@/lib/logger';

interface WebSearchResult {
  content?: string;
  snippet?: string;
}

interface BingRssItem {
  description?: string[];
}

export type { AIComment } from '@/lib/ai-comments.types';

interface GenerateCommentsParams {
  movieName: string;
  movieInfo?: string;
  count?: number;
  aiConfig: AISettings;
}

interface CommentData {
  content: string;
  rating: number | null;
  sentiment: 'positive' | 'neutral' | 'negative';
}

// 生成评论的Prompt
function buildCommentPrompt(
  movieName: string,
  movieInfo?: string,
  searchResults?: string,
  count = 10
): string {
  return `你是一个影评生成助手。请生成真实自然的观众评论。

影片：${movieName}
${movieInfo ? `简介：${movieInfo}` : ''}
${searchResults ? `\n网络评价参考：\n${searchResults}` : ''}

任务要求：
1. 生成${count}条观众评论
2. 每条评论50-200字，口语化、自然
3. 观点多样化：有好评、中评、差评，比例大约6:3:1
4. 可以包含：
   - 个人观影感受和情感共鸣
   - 对演员演技的评价
   - 对剧情、节奏、画面的看法
   - 与其他作品的对比
   - 推荐或不推荐的理由
5. 避免：
   - 过于专业的影评术语
   - 千篇一律的表达
   - 明显的AI痕迹
   - 重复的内容

请直接输出JSON数组格式，不要有其他文字：
[
  {
    "content": "评论内容",
    "rating": 4,
    "sentiment": "positive"
  }
]

注意：rating为1-5的整数或null（表示未评分），sentiment为positive/neutral/negative之一。`;
}

// 联网搜索影片资料
async function searchMovieInfo(
  movieName: string,
  aiConfig: GenerateCommentsParams['aiConfig']
): Promise<string> {
  if (!aiConfig.EnableWebSearch) {
    return '';
  }

  try {
    const provider = aiConfig.WebSearchProvider || 'tavily';
    let searchResults = '';

    if (provider === 'tavily' && aiConfig.TavilyApiKey) {
      const response = await fetch('https://api.tavily.com/search', {
        signal: AbortSignal.timeout(15000),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: aiConfig.TavilyApiKey,
          query: `${movieName} 影评 评价`,
          max_results: 5,
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as { results?: WebSearchResult[] };
        searchResults = data.results
          ?.map((r) => r.content)
          .join('\n')
          .slice(0, 1000) || '';
      }
    } else if (provider === 'serper' && aiConfig.SerperApiKey) {
      const response = await fetch('https://google.serper.dev/search', {
        signal: AbortSignal.timeout(15000),
        method: 'POST',
        headers: {
          'X-API-KEY': aiConfig.SerperApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: `${movieName} 影评 评价`,
          num: 5,
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as { organic?: WebSearchResult[] };
        searchResults = data.organic
          ?.map((r) => r.snippet)
          .join('\n')
          .slice(0, 1000) || '';
      }
    } else if (provider === 'serpapi' && aiConfig.SerpApiKey) {
      const response = await fetch(
        `https://serpapi.com/search?q=${encodeURIComponent(
          movieName + ' 影评 评价'
        )}&api_key=${aiConfig.SerpApiKey}&num=5`,
        { signal: AbortSignal.timeout(15000) }
      );

      if (response.ok) {
        const data = (await response.json()) as { organic_results?: WebSearchResult[] };
        searchResults = data.organic_results
          ?.map((r) => r.snippet)
          .join('\n')
          .slice(0, 1000) || '';
      }
    } else if (provider === 'bing') {
      const response = await fetch(
        `https://www.bing.com/search?format=rss&q=${encodeURIComponent(
          movieName + ' 影评 评价'
        )}`,
        {
          signal: AbortSignal.timeout(15000),
          headers: {
            Accept: 'application/rss+xml, application/xml, text/xml',
            'User-Agent': 'Mozilla/5.0 (compatible; PureTVBot/1.0)',
          },
        }
      );
      if (response.ok) {
        const parsed = await parseStringPromise(await response.text(), {
          trim: true,
        });
        const items = (parsed?.rss?.channel?.[0]?.item || []) as BingRssItem[];
        searchResults = items
          .slice(0, 5)
          .map((item) => item.description?.[0] || '')
          .join('\n')
          .slice(0, 1000);
      }
    }

    return searchResults;
  } catch (error) {
    logger.error('搜索影片资料失败:', error);
    return '';
  }
}

// 调用AI生成评论
export async function generateAIComments(
  params: GenerateCommentsParams
): Promise<AIComment[]> {
  const { movieName, movieInfo, count = 10, aiConfig } = params;
  const connection = resolveAIModelConfig(aiConfig);

  try {
    // 1. 联网搜索影片资料（如果启用）
    const searchResults = await searchMovieInfo(movieName, aiConfig);

    // 2. 构建Prompt
    const prompt = buildCommentPrompt(
      movieName,
      movieInfo,
      searchResults,
      count
    );

    // 3. 调用AI API
    const { protocol, apiKey, baseURL, model } = connection;
    const system = '你是一个专业的影评生成助手，擅长生成真实自然的观众评论。';
    const temperature = aiConfig.Temperature ?? 0.8;
    const maxTokens = aiConfig.MaxTokens ?? 2000;
    const path =
      protocol === 'claude'
        ? 'messages'
        : protocol === 'openai-responses'
        ? 'responses'
        : 'chat/completions';
    const body =
      protocol === 'claude'
        ? {
            model,
            system,
            messages: [{ role: 'user', content: prompt }],
            temperature,
            max_tokens: maxTokens,
          }
        : protocol === 'openai-responses'
        ? {
            model,
            instructions: system,
            input: prompt,
            temperature,
            max_output_tokens: maxTokens,
          }
        : {
            model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: prompt },
            ],
            temperature,
            max_tokens: maxTokens,
          };
    const response = await fetch(`${baseURL}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(protocol === 'claude'
          ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
          : { Authorization: `Bearer ${apiKey}` }),
      },
      body: JSON.stringify({ ...body, stream: false }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      throw new Error(`AI API调用失败: ${response.status}`);
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(
        'AI接口未返回有效JSON，请检查当前协议的 Base URL 是否正确'
      );
    }
    const textBlocks = (
      blocks: Array<{ type?: string; text?: string }> | undefined,
      type: string
    ) =>
      Array.isArray(blocks)
        ? blocks
            .filter(
              (block) => block.type === type && typeof block.text === 'string'
            )
            .map((block) => block.text)
            .join('')
        : '';
    const content =
      protocol === 'claude'
        ? textBlocks(data.content, 'text')
        : protocol === 'openai-responses'
        ? data.output_text ||
          (Array.isArray(data.output)
            ? data.output
                .filter((item: { type?: string }) => item.type === 'message')
                .map(
                  (item: {
                    content?: Array<{ type?: string; text?: string }>;
                  }) => textBlocks(item.content, 'output_text')
                )
                .join('')
            : '')
        : data.choices?.[0]?.message?.content;

    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('AI返回内容为空');
    }

    // 4. 解析AI返回的JSON
    let commentsData: CommentData[];
    try {
      // 尝试提取JSON（可能被markdown代码块包裹）
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        commentsData = JSON.parse(jsonMatch[0]);
      } else {
        commentsData = JSON.parse(content);
      }
      if (
        !Array.isArray(commentsData) ||
        !commentsData.length ||
        commentsData.some(
          (comment) =>
            !comment ||
            typeof comment.content !== 'string' ||
            !comment.content.trim()
        )
      )
        throw new Error('Invalid comments');
    } catch {
      throw new Error('AI返回格式错误');
    }

    // 5. 转换为AIComment格式
    const aiComments: AIComment[] = commentsData.map((comment, index) => {
      const timestamp = Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000; // 随机过去30天内
      const date = new Date(timestamp);

      return {
        id: `ai-${Date.now()}-${index}`,
        userName: generateUserName(index),
        userAvatar: generateAvatar(index),
        rating: comment.rating,
        content: comment.content,
        time: formatTime(date),
        votes: generateVotes(comment.sentiment),
        isAiGenerated: true,
      };
    });

    return aiComments;
  } catch (error) {
    logger.error('AI评论生成失败:', error);
    throw error;
  }
}

// 生成虚拟用户名
function generateUserName(index: number): string {
  const prefixes = [
    '影迷',
    '观众',
    '电影爱好者',
    '剧迷',
    '路人',
    '网友',
    '看客',
  ];
  const prefix = prefixes[index % prefixes.length];
  return `${prefix}${Math.floor(Math.random() * 9000) + 1000}`;
}

// 生成头像URL（使用DiceBear API）
function generateAvatar(seed: number): string {
  const styles = ['avataaars', 'bottts', 'personas', 'micah'];
  const style = styles[seed % styles.length];
  return `https://api.dicebear.com/7.x/${style}/svg?seed=${seed}`;
}

// 格式化时间
function formatTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// 根据情感生成点赞数
function generateVotes(sentiment: string): number {
  if (sentiment === 'positive') {
    return Math.floor(Math.random() * 100) + 20; // 20-120
  } else if (sentiment === 'neutral') {
    return Math.floor(Math.random() * 50) + 5; // 5-55
  } else {
    return Math.floor(Math.random() * 30); // 0-30
  }
}
