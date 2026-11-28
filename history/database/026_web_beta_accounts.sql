-- Apply before deploying Web Beta admission. Existing accounts keep their access.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE account_users ADD COLUMN IF NOT EXISTS web_beta BOOLEAN NOT NULL DEFAULT false;
COMMIT;
