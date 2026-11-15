-- 018: Instagram Business Login only. Additive, no automatic publication.
-- Keeps Meta credentials separate from YouTube and binds OAuth state to 1CE account/browser.
CREATE TABLE IF NOT EXISTS v2_instagram_oauth (
 state_hash CHAR(64) PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
 user_id INTEGER NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
 browser_hash CHAR(64) NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS v2_instagram_oauth_expiry_idx ON v2_instagram_oauth(expires_at);
CREATE TABLE IF NOT EXISTS v2_instagram_connections (
 user_id INTEGER PRIMARY KEY REFERENCES account_users(id) ON DELETE CASCADE,
 instagram_user_id TEXT NOT NULL CHECK (instagram_user_id ~ '^[0-9]{1,32}$'),
 username TEXT NOT NULL CHECK (char_length(username) BETWEEN 1 AND 180),
 access_cipher TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 generation UUID NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
-- No worker should publish merely because these tables exist.
