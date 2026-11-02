-- 1CE v2 ONLY. Never run against the v1 production database.
-- Public metadata points to existing beats/packs; R2 audio, covers and stems are not duplicated.
CREATE TABLE IF NOT EXISTS v2_public_projects (
 user_id INTEGER NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('beat','pack')),
 project_id UUID NOT NULL,
 published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id,kind,project_id)
);
CREATE TABLE IF NOT EXISTS v2_public_saves (
 user_id INTEGER NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
 owner_id INTEGER NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('beat','pack')),
 project_id UUID NOT NULL,
 saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id,owner_id,kind,project_id)
);
CREATE INDEX IF NOT EXISTS v2_public_saves_owner_idx ON v2_public_saves(owner_id,kind,project_id);

-- Sharing an unpublished project grants access only to the redeeming account.
CREATE TABLE IF NOT EXISTS v2_project_access (
 owner_id INTEGER NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
 viewer_id INTEGER NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('beat','pack')),
 project_id UUID NOT NULL,
 granted_at TIMESTAMPTZ DEFAULT now(),
 PRIMARY KEY(owner_id,viewer_id,kind,project_id)
);
CREATE TABLE IF NOT EXISTS v2_project_share_links (
 token_hash TEXT PRIMARY KEY,
 owner_id INTEGER NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('beat','pack')),
 project_id UUID NOT NULL,
 created_at TIMESTAMPTZ DEFAULT now()
);
