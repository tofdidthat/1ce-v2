-- Apply only to isolated 1CE v2 PostgreSQL; never to v1.
-- Existing PATCH /auth/me writes and GET /api/public/profile/:id reads these URLs.
CREATE TABLE IF NOT EXISTS v2_profile_links (
 user_id INTEGER PRIMARY KEY REFERENCES account_users(id) ON DELETE CASCADE,
 links JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(links)='array'),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
