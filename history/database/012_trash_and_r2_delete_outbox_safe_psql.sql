\set ON_ERROR_STOP on
\echo '1CE v2: verifying environment and applying additive migration 012...'
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path TO public, pg_catalog;
-- Refuse to run on a DB that lacks established S2/v2 markers.
DO $v2_guard$
BEGIN
  IF to_regclass('public.account_users') IS NULL
     OR to_regclass('public.library_files') IS NULL
     OR to_regclass('public.library_beats') IS NULL
     OR to_regclass('public.library_packs') IS NULL
     OR to_regclass('public.v2_storage_plans') IS NULL
     OR to_regclass('public.v2_upload_completion_leases') IS NULL
     OR to_regclass('public.v2_api_rate_limits') IS NULL THEN
    RAISE EXCEPTION 'STOP: this database does not have the required v2 S2 schema. Migration 012 was NOT applied.';
  END IF;
END
$v2_guard$;

-- Exact additive migration 012 from tofdidthat/1ce-v2 PR #28,
-- commit b38670adf6dbdc226ea8fb44cace5609743dad2c.
ALTER TABLE library_beats ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE library_packs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS library_beats_trash_idx ON library_beats(user_id,deleted_at DESC) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS library_packs_trash_idx ON library_packs(user_id,deleted_at DESC) WHERE deleted_at IS NOT NULL;
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

-- Fail the transaction if any required objects were not created.
DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='library_beats' AND column_name='deleted_at')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='library_packs' AND column_name='deleted_at')
     OR to_regclass('public.v2_r2_delete_jobs') IS NULL
     OR to_regclass('public.library_beats_trash_idx') IS NULL
     OR to_regclass('public.library_packs_trash_idx') IS NULL
     OR to_regclass('public.v2_r2_delete_jobs_pending_idx') IS NULL THEN
    RAISE EXCEPTION 'STOP: migration 012 validation failed; the transaction will be rolled back.';
  END IF;
END
$verify$;
COMMIT;

\echo '1CE v2 migration 012: verification summary (all results should be true):'
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='library_beats' AND column_name='deleted_at') AS beat_trash_column,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='library_packs' AND column_name='deleted_at') AS pack_trash_column,
  to_regclass('public.v2_r2_delete_jobs') IS NOT NULL AS r2_delete_outbox,
  to_regclass('public.library_beats_trash_idx') IS NOT NULL AS beat_index,
  to_regclass('public.library_packs_trash_idx') IS NOT NULL AS pack_index,
  to_regclass('public.v2_r2_delete_jobs_pending_idx') IS NOT NULL AS r2_pending_index;
