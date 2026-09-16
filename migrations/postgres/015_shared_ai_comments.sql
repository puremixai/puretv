-- Publish one administrator-generated result per movie while retaining legacy rows.
ALTER TABLE ai_comment_jobs ADD COLUMN is_shared BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ai_comment_jobs DROP CONSTRAINT ai_comment_jobs_username_movie_key_key;
ALTER TABLE ai_comment_jobs DROP CONSTRAINT ai_comment_jobs_username_fkey;
ALTER TABLE ai_comment_jobs ALTER COLUMN username DROP NOT NULL;
ALTER TABLE ai_comment_jobs ADD CONSTRAINT ai_comment_jobs_username_fkey
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE SET NULL;

WITH ranked AS (
  SELECT j.id, ROW_NUMBER() OVER (
    PARTITION BY j.movie_key
    ORDER BY (j.result_revision > 0) DESC, j.generated_at DESC NULLS LAST,
      j.updated_at DESC, j.id
  ) AS rank
  FROM ai_comment_jobs j JOIN users u ON u.username = j.username
  WHERE u.role IN ('owner', 'admin')
)
UPDATE ai_comment_jobs SET is_shared = TRUE
WHERE id IN (SELECT id FROM ranked WHERE rank = 1);

-- Private/duplicate legacy jobs must not start a paid request after the upgrade.
UPDATE ai_comment_jobs SET status = 'failed', lease_token = NULL, lease_until = NULL,
  error = 'AI评论已改为管理员按影片统一生成，请由管理员重新提交'
WHERE NOT is_shared AND status IN ('queued', 'running');

CREATE UNIQUE INDEX ai_comment_jobs_shared_movie ON ai_comment_jobs (movie_key)
  WHERE is_shared;
