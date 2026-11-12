-- Additive v2-only visual metadata. Originals remain unchanged in private R2.
CREATE TABLE IF NOT EXISTS v2_audio_waveforms (
 file_id BIGINT PRIMARY KEY REFERENCES library_files(id) ON DELETE CASCADE,
 version TEXT NOT NULL,
 bars JSONB,
 lease_token UUID,
 retry_after TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK (bars IS NULL OR (jsonb_typeof(bars)='array' AND jsonb_array_length(bars)=84))
);

