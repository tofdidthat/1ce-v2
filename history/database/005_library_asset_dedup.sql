-- 1CE v2 ONLY. Apply to isolated v2 PostgreSQL after 004.
-- SHA-256 is scoped to user and file kind, so identical assets can be reused.
ALTER TABLE library_files ADD COLUMN IF NOT EXISTS sha256 TEXT;
ALTER TABLE library_files ADD CONSTRAINT library_files_sha256_format CHECK (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$');
CREATE UNIQUE INDEX IF NOT EXISTS library_files_ready_dedup_idx
 ON library_files(user_id,kind,sha256) WHERE status='ready' AND sha256 IS NOT NULL;
