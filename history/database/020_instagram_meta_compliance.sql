-- Remember pseudonymous Instagram identity links after disconnect/revocation.
-- The mapping associates later Meta callbacks with 1CE owners. Migration 021's
-- approved integration-only cleanup removes these links after data deletion.
CREATE TABLE IF NOT EXISTS v2_instagram_compliance_subjects (
 user_id INTEGER NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
 instagram_user_id_hash CHAR(64) NOT NULL CHECK (instagram_user_id_hash ~ '^[0-9a-f]{64}$'),
 first_seen_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(user_id,instagram_user_id_hash)
);
CREATE INDEX IF NOT EXISTS v2_instagram_compliance_subject_hash_idx
 ON v2_instagram_compliance_subjects(instagram_user_id_hash);

-- Only a digest and the validated v1 acknowledgement; never raw signed_request,
-- Instagram IDs, access tokens or payloads. Retain for callback replay safety.
CREATE TABLE IF NOT EXISTS v2_instagram_compliance_receipts (
 request_hash CHAR(64) PRIMARY KEY CHECK (request_hash ~ '^[0-9a-f]{64}$'),
 action TEXT NOT NULL CHECK (action IN ('deauthorize','data-deletion')),
 legacy_response JSONB,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
