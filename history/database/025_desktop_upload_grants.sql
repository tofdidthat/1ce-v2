-- Apply to the V2 PostgreSQL database before releasing desktop upload.
BEGIN;
CREATE TABLE IF NOT EXISTS account_desktop_upload_grants (
 code_hash TEXT PRIMARY KEY,
 session_id BIGINT NOT NULL REFERENCES account_sessions(id) ON DELETE CASCADE,
 challenge TEXT NOT NULL,
 code_expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '2 minutes',
 token_hash TEXT UNIQUE,
 token_expires_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS account_desktop_upload_grants_session_idx
 ON account_desktop_upload_grants(session_id);
COMMIT;
