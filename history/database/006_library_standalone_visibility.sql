-- v2 only. A beat created as part of a pack is not a standalone Library card.
-- Existing standalone beats stay visible when linked to packs.
ALTER TABLE library_beats ADD COLUMN IF NOT EXISTS library_visible BOOLEAN NOT NULL DEFAULT TRUE;
-- Backfill only beats created in the same immediate upload as a pack (legacy v2 imports).
-- Do not hide older standalone beats that were added to packs later.
UPDATE library_beats b SET library_visible=FALSE
WHERE b.library_visible=TRUE
AND EXISTS (
 SELECT 1 FROM library_pack_beats pb JOIN library_packs p ON p.id=pb.pack_id
 WHERE pb.beat_id=b.id AND p.user_id=b.user_id
 AND b.created_at<=p.created_at
 AND b.created_at>=p.created_at-INTERVAL '2 minutes'
);
