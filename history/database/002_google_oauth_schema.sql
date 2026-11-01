-- 1CE v2 only. Run against the independent v2 PostgreSQL database.
CREATE TABLE IF NOT EXISTS account_google_login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash TEXT NOT NULL UNIQUE,
  verifier_challenge TEXT NOT NULL,
  user_id INTEGER REFERENCES account_users(id) ON DELETE SET NULL,
  exchange_hash TEXT UNIQUE,
  callback_used_at TIMESTAMPTZ,
  exchanged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '10 minutes',
  exchange_expires_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS account_google_login_attempts_expires_idx ON account_google_login_attempts(expires_at);
CREATE INDEX IF NOT EXISTS account_google_login_attempts_exchange_idx ON account_google_login_attempts(exchange_hash);
