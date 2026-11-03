-- 1CE v2 ONLY: additive S2/PR #27 security migration. Apply manually to
-- the isolated v2 PostgreSQL BEFORE deploying code that imports rateLimitExceeded.
-- No user, session, asset or existing table is modified or deleted.
CREATE TABLE IF NOT EXISTS v2_api_rate_limits (
 scope TEXT NOT NULL,
 subject_hash TEXT NOT NULL CHECK (subject_hash ~ '^[a-f0-9]{64}$'),
 window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 hits INTEGER NOT NULL CHECK (hits >= 1),
 PRIMARY KEY(scope,subject_hash)
);
CREATE INDEX IF NOT EXISTS v2_api_rate_limits_window_idx
 ON v2_api_rate_limits(window_started_at);
-- Operational maintenance (manual/scheduled, not automatically run in PR):
-- DELETE FROM v2_api_rate_limits WHERE window_started_at < now()-interval '7 days';
