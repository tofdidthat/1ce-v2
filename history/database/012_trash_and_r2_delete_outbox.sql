-- 1CE v2 PR #28. Apply only to isolated v2 PostgreSQL BEFORE deploying UI/API.
ALTER TABLE library_beats ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE library_packs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS library_beats_trash_idx ON library_beats(user_id,deleted_at DESC) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS library_packs_trash_idx ON library_packs(user_id,deleted_at DESC) WHERE deleted_at IS NOT NULL;
-- Durable record of verified objects retired from the database; deletion is retried if R2 fails.
CREATE TABLE IF NOT EXISTS v2_r2_delete_jobs (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
 object_key TEXT NOT NULL UNIQUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 completed_at TIMESTAMPTZ,
 claim_token UUID,
 claim_until TIMESTAMPTZ,
 attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts>=0),
 last_error TEXT,
 CHECK ((claim_token IS NULL) = (claim_until IS NULL))
);
CREATE INDEX IF NOT EXISTS v2_r2_delete_jobs_pending_idx
 ON v2_r2_delete_jobs(user_id,created_at,id) WHERE completed_at IS NULL;
