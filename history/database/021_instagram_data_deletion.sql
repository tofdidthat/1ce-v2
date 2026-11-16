-- Approved scope: Instagram integration data/derived MP4s only. Preserve
-- account_users, original library files and every non-Instagram destination.
-- Owner references exist only while cleanup is pending; completion erases them.
ALTER TABLE v2_instagram_oauth ADD COLUMN IF NOT EXISTS claim_token UUID;
CREATE TABLE IF NOT EXISTS v2_instagram_data_deletions (
 request_hash CHAR(64) PRIMARY KEY REFERENCES v2_instagram_compliance_receipts(request_hash),
 confirmation_hash CHAR(64) UNIQUE NOT NULL CHECK (confirmation_hash ~ '^[0-9a-f]{64}$'),
 owners INTEGER[] NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 -- Allow bounded in-flight PUTs to abort after credentials/claims are fenced.
 not_before TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()+interval '2 minutes',
 completed_at TIMESTAMPTZ,
 CHECK ((completed_at IS NULL AND cardinality(owners)>0) OR
        (completed_at IS NOT NULL AND cardinality(owners)=0))
);
CREATE INDEX IF NOT EXISTS v2_instagram_data_deletions_pending_idx
 ON v2_instagram_data_deletions(not_before) WHERE completed_at IS NULL;
