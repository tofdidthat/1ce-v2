-- 1CE v2 only. Additive S2 plan entitlements and completion fencing.
-- Deploy only after PR27 release approval, after 010_api_rate_limits.sql.
-- No paid subscriptions, billing, price or commercial tier names are created.
-- The sole seeded "default" plan preserves the current conservative 10 GiB.
CREATE TABLE IF NOT EXISTS v2_storage_plans (
 code TEXT PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_-]{0,39}$'),
 storage_limit_bytes BIGINT NOT NULL CHECK (storage_limit_bytes BETWEEN 1048576 AND 1099511627776),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO v2_storage_plans(code,storage_limit_bytes)
 VALUES('default',10737418240) ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS v2_account_storage_plans (
 user_id INTEGER PRIMARY KEY REFERENCES account_users(id) ON DELETE CASCADE,
 plan_code TEXT NOT NULL REFERENCES v2_storage_plans(code) ON UPDATE CASCADE,
 assigned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS v2_account_storage_plans_code_idx
 ON v2_account_storage_plans(plan_code);

-- Per-file lease is short metadata, not a long-lived PostgreSQL connection.
-- Ownership checks happen in acquisition; unique file_id arbitrates replicas.
CREATE TABLE IF NOT EXISTS v2_upload_completion_leases (
 file_id BIGINT PRIMARY KEY REFERENCES library_files(id) ON DELETE CASCADE,
 lease_token UUID NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS v2_upload_completion_leases_expires_idx
 ON v2_upload_completion_leases(expires_at);

-- Operators may later INSERT more plan codes and assign users to them by
-- v2_account_storage_plans. Do not do that as part of this S2 migration.
-- Plan downgrade remains safe: existing READY media is NEVER deleted.
