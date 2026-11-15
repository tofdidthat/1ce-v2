-- 1CE v2 R03: durable publication planning and attempt ledger.
-- Additive only. Does NOT schedule or perform external publishing.
-- Apply to the isolated v2 database only, after 001 and 003.
CREATE TABLE IF NOT EXISTS v2_publication_jobs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id INTEGER NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
 request_id UUID NOT NULL,
 request_hash CHAR(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
 title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
 description TEXT NOT NULL DEFAULT '' CHECK (char_length(description)<=2000),
 hashtags TEXT NOT NULL DEFAULT '' CHECK (char_length(hashtags)<=500),
 -- Only a verified rendering/media pipeline may transition draft -> ready.
 state TEXT NOT NULL DEFAULT 'draft'
  CHECK (state IN ('draft','ready','running','succeeded','failed','cancelled')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE (user_id,request_id)
);
CREATE INDEX IF NOT EXISTS v2_publication_jobs_owner_idx
 ON v2_publication_jobs(user_id,created_at DESC,id);

CREATE TABLE IF NOT EXISTS v2_publication_targets (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 job_id UUID NOT NULL REFERENCES v2_publication_jobs(id) ON DELETE CASCADE,
 platform TEXT NOT NULL CHECK (platform IN ('youtube','tiktok','instagram','telegram','discord')),
 variant TEXT NOT NULL DEFAULT 'default',
 state TEXT NOT NULL DEFAULT 'draft'
  CHECK (state IN ('draft','queued','running','retryable','succeeded','failed','needs_review','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts>=0 AND attempts<=30),
 next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 claim_token UUID,
 claim_until TIMESTAMPTZ,
 remote_id TEXT,
 last_error_code TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK (
  (platform='youtube' AND variant IN ('shorts','standard')) OR
  (platform<>'youtube' AND variant='default')
 ),
 CHECK ((claim_token IS NULL) = (claim_until IS NULL)),
 CHECK ((state='running') = (claim_token IS NOT NULL)),
 UNIQUE (job_id,platform,variant)
);
CREATE INDEX IF NOT EXISTS v2_publication_targets_due_idx
 ON v2_publication_targets(next_attempt_at,id)
 WHERE state IN ('queued','retryable');

CREATE TABLE IF NOT EXISTS v2_publication_attempts (
 target_id BIGINT NOT NULL REFERENCES v2_publication_targets(id) ON DELETE CASCADE,
 attempt INTEGER NOT NULL CHECK(attempt>0),
 claim_token UUID NOT NULL,
 started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 ended_at TIMESTAMPTZ,
 outcome TEXT CHECK (outcome IN ('succeeded','retryable','failed','needs_review')),
 error_code TEXT,
 remote_id TEXT,
 PRIMARY KEY(target_id,attempt),
 UNIQUE(target_id,claim_token),
 CHECK ((outcome IS NULL) = (ended_at IS NULL))
);
-- Credentials, refresh tokens, resumable session URLs and private media
-- are deliberately NOT stored in this ledger. A future worker must store
-- credentials in an encrypted provider-connection store and keep upload
-- checkpoints in a separate protected table.
