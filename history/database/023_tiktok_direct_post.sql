ALTER TABLE v2_publication_jobs ADD COLUMN IF NOT EXISTS tiktok_preferences JSONB;
CREATE TABLE IF NOT EXISTS v2_tiktok_checkpoints (
 target_id BIGINT PRIMARY KEY REFERENCES v2_publication_targets(id) ON DELETE CASCADE,
 connection_generation UUID NOT NULL,
 artifact_key TEXT NOT NULL,
 artifact_sha CHAR(64) NOT NULL,
 artifact_bytes BIGINT NOT NULL CHECK(artifact_bytes BETWEEN 1 AND 268435456),
 token_hash CHAR(64) NOT NULL UNIQUE,
 expires_at TIMESTAMPTZ NOT NULL,
 publish_id TEXT,
 init_claim UUID NOT NULL
);
ALTER TABLE v2_tiktok_connections ADD COLUMN IF NOT EXISTS nickname TEXT;
ALTER TABLE v2_tiktok_connections ADD COLUMN IF NOT EXISTS username TEXT;
