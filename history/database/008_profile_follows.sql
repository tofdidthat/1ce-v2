-- 1CE v2 ONLY. Idempotent schema for permanent follow relationships.
-- Never apply to v1; application can bootstrap this same isolated table on first use.
CREATE TABLE IF NOT EXISTS v2_profile_follows (
  follower_id INTEGER NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
  followed_id INTEGER NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followed_id),
  CONSTRAINT v2_profile_follows_no_self CHECK (follower_id <> followed_id)
);
CREATE INDEX IF NOT EXISTS v2_profile_follows_followed_idx
  ON v2_profile_follows (followed_id, created_at DESC);
