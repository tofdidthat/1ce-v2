-- 1CE Instagram Reels R02: additive, disabled without explicit server opt-in.
-- No secrets, token URLs, or original R2 media are public in this schema.
ALTER TABLE v2_publication_jobs ADD COLUMN IF NOT EXISTS instagram_generation UUID;
ALTER TABLE v2_publication_jobs ADD COLUMN IF NOT EXISTS instagram_public_confirmed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS v2_instagram_checkpoints (
 target_id BIGINT PRIMARY KEY REFERENCES v2_publication_targets(id) ON DELETE CASCADE,
 connection_generation UUID NOT NULL,
 artifact_key TEXT NOT NULL,
 artifact_sha CHAR(64) NOT NULL CHECK (artifact_sha ~ '^[0-9a-f]{64}$'),
 artifact_bytes BIGINT NOT NULL CHECK (artifact_bytes BETWEEN 1 AND 268435456),
 container_id TEXT CHECK (container_id IS NULL OR container_id ~ '^[0-9]{1,32}$'),
 publish_started_at TIMESTAMPTZ,
 published_media_id TEXT CHECK (published_media_id IS NULL OR published_media_id ~ '^[0-9]{1,32}$'),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS v2_instagram_media_grants (
 target_id BIGINT PRIMARY KEY REFERENCES v2_publication_targets(id) ON DELETE CASCADE,
 token_hash CHAR(64) UNIQUE NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
 expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS v2_instagram_media_grants_expiry_idx ON v2_instagram_media_grants(expires_at);
-- A confirmed Instagram job is still NOT queued automatically. Enqueue must
-- verify the per-account grant AND an explicit public-post acknowledgement.
