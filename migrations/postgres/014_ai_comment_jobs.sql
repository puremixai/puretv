CREATE TABLE IF NOT EXISTS ai_comment_jobs (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  movie_key TEXT NOT NULL,
  movie_name TEXT NOT NULL,
  movie_year TEXT NOT NULL DEFAULT '',
  movie_info TEXT NOT NULL DEFAULT '',
  requested_count INTEGER NOT NULL CHECK (requested_count BETWEEN 1 AND 50),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  generation_id TEXT NOT NULL,
  lease_token TEXT,
  lease_until BIGINT,
  attempts INTEGER NOT NULL DEFAULT 0,
  comments JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(comments) = 'array'),
  result_revision INTEGER NOT NULL DEFAULT 0,
  generated_at BIGINT,
  model TEXT,
  protocol TEXT,
  error TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE (username, movie_key)
);
CREATE INDEX IF NOT EXISTS ai_comment_jobs_pending ON ai_comment_jobs (status, updated_at)
  WHERE status IN ('queued', 'running');
