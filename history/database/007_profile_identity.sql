-- 1CE v2 only. Apply to the isolated v2 PostgreSQL BEFORE deploying the API changes.
-- Usernames identify public profiles; avatars remain objects in the private v2 R2 bucket.
-- Existing v1 handles/avatars are not migrated or modified.
ALTER TABLE account_users ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE account_users ADD COLUMN IF NOT EXISTS avatar_key TEXT;
ALTER TABLE account_users ADD COLUMN IF NOT EXISTS avatar_updated_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS account_users_username_unique_idx
 ON account_users (username) WHERE username IS NOT NULL;
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='account_users_username_format_chk') THEN
  ALTER TABLE account_users ADD CONSTRAINT account_users_username_format_chk CHECK (
   username IS NULL OR (
    username ~ '^[a-z0-9][a-z0-9._]{1,22}[a-z0-9]$'
    AND username NOT LIKE '%..%'
    AND username !~ '^[0-9]+$'
   )
  );
 END IF;
END $$;
