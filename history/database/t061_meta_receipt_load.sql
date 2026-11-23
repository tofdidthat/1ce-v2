-- Execute inside the transaction that created and populated t061_meta_receipt_stage.
SELECT pg_advisory_xact_lock(hashtextextended('t061-meta-receipt-load', 0));

DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM t061_meta_receipt_stage) THEN
  RAISE EXCEPTION 'Empty batch: verify source inventory before continuing';
 END IF;
 IF EXISTS (
  SELECT confirmation_hash FROM t061_meta_receipt_stage
  GROUP BY confirmation_hash HAVING count(*) > 1
 ) THEN
  RAISE EXCEPTION 'Duplicate confirmation hash in import batch';
 END IF;
 IF EXISTS (
  SELECT 1 FROM t061_meta_receipt_stage s
  JOIN v2_instagram_legacy_deletion_status d USING (confirmation_hash)
  WHERE d.completed_at IS NOT NULL AND s.completed_at IS NOT NULL
    AND d.completed_at <> s.completed_at
 ) THEN
  RAISE EXCEPTION 'Conflicting verified completion timestamps';
 END IF;
END $$;

INSERT INTO v2_instagram_legacy_deletion_status AS d (confirmation_hash, completed_at)
SELECT confirmation_hash, completed_at FROM t061_meta_receipt_stage
ON CONFLICT (confirmation_hash) DO UPDATE SET completed_at = EXCLUDED.completed_at
WHERE d.completed_at IS NULL AND EXCLUDED.completed_at IS NOT NULL;

-- Completeness is checked before the operator can commit. A stale pending row
-- is allowed only when the destination already has verified completion.
DO $$
BEGIN
 IF EXISTS (
  SELECT 1 FROM t061_meta_receipt_stage s
  LEFT JOIN v2_instagram_legacy_deletion_status d USING (confirmation_hash)
  WHERE d.confirmation_hash IS NULL
    OR (s.completed_at IS NOT NULL AND d.completed_at IS DISTINCT FROM s.completed_at)
 ) THEN
  RAISE EXCEPTION 'Receipt reconciliation failed';
 END IF;
END $$;

SELECT count(*) AS matched,
 count(*) FILTER (WHERE d.completed_at IS NULL) AS pending,
 count(*) FILTER (WHERE d.completed_at IS NOT NULL) AS completed,
 count(*) FILTER (WHERE s.completed_at IS NULL AND d.completed_at IS NOT NULL) AS stale_pending
FROM t061_meta_receipt_stage s
JOIN v2_instagram_legacy_deletion_status d USING (confirmation_hash);
