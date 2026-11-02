-- 1CE v2 only. Apply to the isolated v2 PostgreSQL before enabling grouped uploads.
CREATE TABLE IF NOT EXISTS library_collections (
 id UUID PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
 type TEXT NOT NULL CHECK(type IN ('beat','pack')),
 title TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','ready')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS library_collections_user_idx ON library_collections(user_id,created_at DESC);
ALTER TABLE library_files ADD COLUMN IF NOT EXISTS collection_id UUID REFERENCES library_collections(id) ON DELETE CASCADE;
ALTER TABLE library_files ADD COLUMN IF NOT EXISTS track_id UUID;
CREATE INDEX IF NOT EXISTS library_files_collection_idx ON library_files(collection_id);
CREATE UNIQUE INDEX IF NOT EXISTS library_files_one_collection_cover ON library_files(collection_id) WHERE kind='cover' AND collection_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS library_files_one_track_audio ON library_files(collection_id,track_id) WHERE kind='audio' AND collection_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS library_files_one_track_stems ON library_files(collection_id,track_id) WHERE kind='stems' AND collection_id IS NOT NULL;
