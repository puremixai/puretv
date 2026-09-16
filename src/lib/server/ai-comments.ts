import { createHash } from 'crypto';

import { generateAIComments } from '@/lib/ai-comment-generator';
import type { AICommentMovie, SavedAIComments } from '@/lib/ai-comments.types';
import {
  AIConfigurationError,
  resolveAIModelConfig,
} from '@/lib/ai-model-config';
import { readCache, writeCache } from '@/lib/cache-backend';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

import { createAICommentsStore } from '../../../server/ai-comments-store';

export function aiCommentMovieKey(movie: AICommentMovie) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        movie.name.normalize('NFKC').trim().toLowerCase(),
        movie.year.trim(),
        movie.count,
      ])
    )
    .digest('hex');
}

function cacheKey(id: string, revision: number) {
  return `${
    process.env.CACHE_KEY_PREFIX || 'puretv:cache'
  }:ai-comments:v1:${id}:${revision}`;
}

export async function readSavedAIComments(
  movie: AICommentMovie
): Promise<SavedAIComments> {
  const store = createAICommentsStore();
  // A regeneration can finish between reading metadata and loading the result.
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await store.get(aiCommentMovieKey(movie));
    if (!row)
      return {
        status: 'idle',
        comments: [],
        total: 0,
        movieName: movie.name,
        isAiGenerated: true,
      };
    let comments = [];
    if (row.result_revision > 0) {
      const key = cacheKey(row.id, row.result_revision);
      let cached;
      try {
        cached = JSON.parse((await readCache(key)) || 'null');
      } catch {
        /* Read the canonical database result. */
      }
      if (
        Array.isArray(cached) &&
        cached.every(
          (item) =>
            item &&
            typeof item.content === 'string' &&
            item.isAiGenerated === true
        )
      )
        comments = cached;
      else {
        const result = await store.getResult(row.id, row.result_revision);
        if (result === null) continue;
        comments = result;
        await writeCache(key, JSON.stringify(comments), 86400000);
      }
    }
    return {
      status: row.status,
      jobId: row.id,
      generationId: row.generation_id,
      comments,
      total: comments.length,
      movieName: row.movie_name,
      generatedAt: row.generated_at
        ? new Date(row.generated_at).toISOString()
        : undefined,
      error: row.error || undefined,
      isAiGenerated: true,
    };
  }
  throw new Error('评论已更新，请重试读取');
}

export async function enqueueAIComments(
  username: string,
  movie: AICommentMovie,
  regenerate: boolean
) {
  const store = createAICommentsStore();
  const existing = await store.get(aiCommentMovieKey(movie));
  if (
    !existing ||
    (regenerate && !['queued', 'running'].includes(existing.status))
  ) {
    const config = await getConfig();
    if (!config.AIConfig?.Enabled || !config.AIConfig.EnableAIComments)
      throw new Error('AI评论功能未启用');
    resolveAIModelConfig(config.AIConfig);
  }
  await store.enqueue(username, aiCommentMovieKey(movie), movie, regenerate);
  return readSavedAIComments(movie);
}

export async function runAICommentJob() {
  const store = createAICommentsStore();
  const job = await store.claim();
  if (!job) return false;
  try {
    const [config, user] = await Promise.all([
      getConfig(),
      job.username ? db.getUserInfoV2(job.username, true) : null,
    ]);
    if (
      !user ||
      user.banned ||
      (user.role !== 'admin' && user.role !== 'owner')
    )
      throw new Error('AI评论生成权限已关闭');
    const aiConfig = config.AIConfig;
    if (!aiConfig?.Enabled || !aiConfig.EnableAIComments)
      throw new Error('AI评论功能已关闭');
    const connection = resolveAIModelConfig(aiConfig);
    const comments = await generateAIComments({
      movieName: job.movie_name,
      movieInfo: [
        job.movie_year ? `年份：${job.movie_year}` : '',
        job.movie_info,
      ]
        .filter(Boolean)
        .join('\n'),
      count: job.requested_count,
      aiConfig,
    });
    const completed = await store.complete(
      job.id,
      job.lease_token,
      comments,
      connection
    );
    if (completed)
      await writeCache(
        cacheKey(job.id, completed.result_revision),
        JSON.stringify(comments),
        86400000
      );
  } catch (error) {
    const message =
      error instanceof AIConfigurationError ||
      (error instanceof Error && /^AI/.test(error.message))
        ? (error as Error).message
        : 'AI评论生成失败或超时，请点击重试';
    await store.fail(job.id, job.lease_token, message);
  }
  return true;
}
