-- 1CE v2 ONLY. Apply after 003, ONLY to the isolated v2 PostgreSQL.
-- A physical R2 object is a library_files row. Beats and packs reference it by ID.
-- Never store an audio/cover/stems copy just because a beat is added to a pack.
CREATE TABLE IF NOT EXISTS library_beats (
 id UUID PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
 title TEXT NOT NULL,
 audio_file_id BIGINT NOT NULL REFERENCES library_files(id) ON DELETE RESTRICT,
 cover_file_id BIGINT REFERENCES library_files(id) ON DELETE RESTRICT,
 stems_file_id BIGINT REFERENCES library_files(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(user_id,audio_file_id)
);
CREATE INDEX IF NOT EXISTS library_beats_user_idx ON library_beats(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS library_packs (
 id UUID PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
 title TEXT NOT NULL,
 cover_file_id BIGINT REFERENCES library_files(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS library_packs_user_idx ON library_packs(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS library_pack_beats (
 pack_id UUID NOT NULL REFERENCES library_packs(id) ON DELETE CASCADE,
 beat_id UUID NOT NULL REFERENCES library_beats(id) ON DELETE RESTRICT,
 position INTEGER NOT NULL CHECK(position>=0),
 PRIMARY KEY(pack_id,beat_id),
 UNIQUE(pack_id,position)
);
CREATE INDEX IF NOT EXISTS library_pack_beats_beat_idx ON library_pack_beats(beat_id);
-- References to an existing asset never create a new object in R2.
-- Deleting an asset is a separate operation and must check references first.
