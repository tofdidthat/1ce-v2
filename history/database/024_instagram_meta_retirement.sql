ALTER TABLE v2_instagram_compliance_receipts
 ADD COLUMN IF NOT EXISTS v2_only BOOLEAN NOT NULL DEFAULT FALSE;

-- Populate only from verified V1 receipts during a separately authorized cutover.
-- No raw confirmation codes, Meta user IDs or account data are needed here.
CREATE TABLE IF NOT EXISTS v2_instagram_legacy_deletion_status (
 confirmation_hash CHAR(64) PRIMARY KEY CHECK (confirmation_hash ~ '^[0-9a-f]{64}$'),
 completed_at TIMESTAMPTZ
);
