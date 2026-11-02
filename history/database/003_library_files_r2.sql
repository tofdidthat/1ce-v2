-- 1CE v2 ONLY. Apply to the independent v2 PostgreSQL database before enabling uploads.
-- Files are private in Cloudflare R2; this table stores metadata and ownership only.
CREATE TABLE IF NOT EXISTS library_files (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('audio','cover','stems')),
  object_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS library_files_user_created_idx ON library_files(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS library_files_pending_idx ON library_files(created_at) WHERE status='pending';
