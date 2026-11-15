-- v2-only: authorized YouTube connections and private resumable checkpoints.
ALTER TABLE v2_publication_jobs ADD COLUMN IF NOT EXISTS audio_file_id BIGINT REFERENCES library_files(id) ON DELETE SET NULL;
ALTER TABLE v2_publication_jobs ADD COLUMN IF NOT EXISTS cover_file_id BIGINT REFERENCES library_files(id) ON DELETE SET NULL;
ALTER TABLE v2_publication_jobs ADD COLUMN IF NOT EXISTS privacy TEXT NOT NULL DEFAULT 'private' CHECK (privacy IN ('private','unlisted','public'));
ALTER TABLE v2_publication_jobs ADD COLUMN IF NOT EXISTS youtube_generation UUID;
CREATE TABLE IF NOT EXISTS v2_youtube_connections (
 user_id INTEGER PRIMARY KEY REFERENCES account_users(id) ON DELETE CASCADE,
 refresh_cipher TEXT NOT NULL,
 channel_id TEXT NOT NULL,
 channel_title TEXT NOT NULL,
 generation UUID NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS v2_youtube_oauth (
 state_hash TEXT PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
 browser_hash TEXT NOT NULL,
 verifier_cipher TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS v2_youtube_oauth_expiry_idx ON v2_youtube_oauth(expires_at);
CREATE TABLE IF NOT EXISTS v2_youtube_checkpoints (
 target_id BIGINT PRIMARY KEY REFERENCES v2_publication_targets(id) ON DELETE CASCADE,
 connection_generation UUID NOT NULL,
 artifact_key TEXT NOT NULL,
 artifact_sha CHAR(64) NOT NULL,
 artifact_bytes BIGINT NOT NULL CHECK (artifact_bytes BETWEEN 1 AND 268435456),
 session_cipher TEXT,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Register before PUT, so even a crash before checkpointing cannot orphan a render forever.
CREATE TABLE IF NOT EXISTS v2_publication_artifacts (
 object_key TEXT PRIMARY KEY,
 user_id INTEGER NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '7 days'
);
