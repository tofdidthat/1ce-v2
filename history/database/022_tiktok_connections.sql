-- TikTok Login Kit: OAuth connection only. No TikTok posting worker or jobs.
-- Applied by the idempotent publishing schema loader, scoped to the v2 database.
CREATE TABLE IF NOT EXISTS v2_tiktok_oauth (
  state_hash CHAR(64) PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  user_id INTEGER NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
  browser_hash TEXT NOT NULL DEFAULT '',
  claim_token UUID,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS v2_tiktok_oauth_user_idx ON v2_tiktok_oauth(user_id);
CREATE INDEX IF NOT EXISTS v2_tiktok_oauth_expiry_idx ON v2_tiktok_oauth(expires_at);

CREATE TABLE IF NOT EXISTS v2_tiktok_connections (
  user_id INTEGER PRIMARY KEY REFERENCES account_users(id) ON DELETE CASCADE,
  open_id TEXT NOT NULL CHECK (char_length(open_id) BETWEEN 1 AND 200),
  scope TEXT NOT NULL DEFAULT '',
  access_cipher TEXT NOT NULL,
  refresh_cipher TEXT NOT NULL,
  access_expires_at TIMESTAMPTZ NOT NULL,
  refresh_expires_at TIMESTAMPTZ NOT NULL,
  generation UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS v2_tiktok_refresh_expiry_idx ON v2_tiktok_connections(refresh_expires_at);
