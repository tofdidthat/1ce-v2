-- Remember pseudonymous Instagram identity links after disconnect/revocation.
-- The mapping lets a later Meta data-deletion callback fail closed until 1CE
-- has a reviewed deletion contract for its own publication records.
CREATE TABLE IF NOT EXISTS v2_instagram_compliance_subjects (
 user_id INTEGER NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
 instagram_user_id_hash CHAR(64) NOT NULL CHECK (instagram_user_id_hash ~ '^[0-9a-f]{64}$'),
 first_seen_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(user_id,instagram_user_id_hash)
);
CREATE INDEX IF NOT EXISTS v2_instagram_compliance_subject_hash_idx
 ON v2_instagram_compliance_subjects(instagram_user_id_hash);
