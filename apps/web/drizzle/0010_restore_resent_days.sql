-- Existing fingerprints stay null. Receipts have no provider or model, and
-- expired sets cannot be recovered. A later accepted Sync supplies evidence.
ALTER TABLE "usage_days" ADD COLUMN "receipt_fingerprint" bytea;
--> statement-breakpoint
-- Restore Usage rows that were Quarantined only because a Device sent a day
-- again after its watermark had moved past it (`sync --since N`). The Sync now
-- keeps the stored row for such a day (keptRows in src/lib/sync.ts); this puts
-- back the verdict each row had before the re-send overwrote it.
--
-- A row qualifies when `stale_backfill` is its only failed check. The other
-- reasons it may carry, a thin Receipt Stream and a duplicate of another
-- Device, only ever make a row Reported. Rows whose latest Admin decision is
-- `keep` stay out. The next daily mint pays the restored days, because the mint tops a day
-- up to what it is worth.
CREATE TEMP TABLE restored_usage ON COMMIT DROP AS
SELECT u.device_id, u.builder_id, u.day, u.provider, u.model
FROM usage_days u
WHERE u.trust_level = 'quarantined'
  AND u.quarantine_reasons @> '[{"code": "stale_backfill"}]'::jsonb
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(u.quarantine_reasons) AS r(reason)
    WHERE r.reason->>'code' NOT IN ('stale_backfill', 'receipt_stream_thin', 'duplicate_of_device')
  )
  AND COALESCE(
    (
      SELECT q.decision
      FROM quarantine_reviews q
      WHERE q.device_id = u.device_id
        AND q.day = u.day
        AND q.provider = u.provider
        AND q.model = u.model
      ORDER BY q.created_at DESC
      LIMIT 1
    ),
    'verified'
  ) <> 'keep';
--> statement-breakpoint
-- The verdict the checks give without the watermark: Verified with a Receipt
-- Stream, Reported without one, Reported when the stream is thin or the row is
-- another Device's work.
UPDATE usage_days u
SET
  trust_level = CASE
    WHEN u.duplicate_of_device_id IS NOT NULL
      OR u.receipt_count = 0
      OR u.quarantine_reasons @> '[{"code": "receipt_stream_thin"}]'::jsonb
    THEN 'reported'::trust_level
    ELSE 'verified'::trust_level
  END,
  quarantine_reasons = CASE
    WHEN u.receipt_count = 0 AND u.duplicate_of_device_id IS NULL
    THEN '[{"code": "no_receipt_stream", "message": "This agent does not expose message identifiers, so Usage is self-reported."}]'::jsonb
    ELSE COALESCE(
      (
        SELECT jsonb_agg(r.reason ORDER BY r.position)
        FROM jsonb_array_elements(u.quarantine_reasons) WITH ORDINALITY AS r(reason, position)
        WHERE r.reason->>'code' <> 'stale_backfill'
      ),
      '[]'::jsonb
    )
  END
FROM restored_usage x
WHERE u.device_id = x.device_id
  AND u.day = x.day
  AND u.provider = x.provider
  AND u.model = x.model;
--> statement-breakpoint
CREATE TEMP TABLE dedup_repaired_usage ON COMMIT DROP AS
SELECT device_id, builder_id, day, provider, model
FROM usage_days
WHERE false;
--> statement-breakpoint
-- Old-day matches used approximate totals when the row was checked outside
-- receipt retention. Rows without receipts have no evidence for a match.
-- Limit old-day repairs to checks after the heuristic was introduced in
-- a0c4b02 on 2026-10-21. Earlier duplicates could use retained raw receipts.
-- The former receipt lookup also linked different models. Clear a link whose
-- target has no matching Usage row. Preserve all other checks and
-- explicit Admin decisions, including stale-backfill quarantine.
WITH repaired AS (
  UPDATE usage_days u
  SET
    duplicate_of_device_id = NULL,
    trust_level = CASE
      WHEN u.trust_level = 'quarantined' THEN u.trust_level
      WHEN u.receipt_count = 0 OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(u.quarantine_reasons) AS r(reason)
        WHERE r.reason->>'code' <> 'duplicate_of_device'
      ) THEN 'reported'::trust_level
      ELSE 'verified'::trust_level
    END,
    quarantine_reasons = COALESCE((
      SELECT jsonb_agg(r.reason ORDER BY r.position)
      FROM jsonb_array_elements(u.quarantine_reasons) WITH ORDINALITY AS r(reason, position)
      WHERE r.reason->>'code' <> 'duplicate_of_device'
    ), '[]'::jsonb) || CASE
      WHEN u.receipt_count = 0
        AND NOT u.quarantine_reasons @> '[{"code": "no_receipt_stream"}]'::jsonb
      THEN '[{"code": "no_receipt_stream", "message": "This agent does not expose message identifiers, so Usage is self-reported."}]'::jsonb
      ELSE '[]'::jsonb
    END
  WHERE u.duplicate_of_device_id IS NOT NULL
    AND u.receipt_fingerprint IS NULL
    AND (
      u.receipt_count = 0 OR NOT EXISTS (
        SELECT 1 FROM usage_days owner
        WHERE owner.device_id = u.duplicate_of_device_id
          AND owner.builder_id = u.builder_id AND owner.day = u.day
          AND owner.provider = u.provider AND owner.model = u.model
      ) OR (
        u.checked_at >= '2026-10-21T13:48:45Z'::timestamptz
        AND u.day < (u.checked_at AT TIME ZONE 'UTC')::date - 6
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM quarantine_reviews q
      WHERE q.device_id = u.device_id AND q.day = u.day
        AND q.provider = u.provider AND q.model = u.model
    )
  RETURNING device_id, builder_id, day, provider, model
)
INSERT INTO dedup_repaired_usage SELECT * FROM repaired;
--> statement-breakpoint
-- Follow each remaining duplicate chain. A cycle has no counted owner.
-- Select one unreviewed cycle member as the owner and point the other rows at
-- it. Chains that already end at a counted owner are shortened to that owner.
WITH RECURSIVE walk AS (
  SELECT u.device_id AS start_device_id, u.builder_id, u.day, u.provider, u.model,
    u.device_id, u.duplicate_of_device_id AS next_device_id, ARRAY[u.device_id] AS path
  FROM usage_days u
  WHERE u.duplicate_of_device_id IS NOT NULL
  UNION ALL
  SELECT w.start_device_id, w.builder_id, w.day, w.provider, w.model,
    u.device_id, u.duplicate_of_device_id, w.path || u.device_id
  FROM walk w
  JOIN usage_days u ON u.device_id = w.next_device_id
    AND u.builder_id = w.builder_id AND u.day = w.day
    AND u.provider = w.provider AND u.model = w.model
  WHERE NOT w.next_device_id = ANY(w.path)
), owners AS (
  SELECT w.start_device_id, w.builder_id, w.day, w.provider, w.model,
    CASE WHEN w.next_device_id IS NULL THEN w.device_id ELSE (
      SELECT MIN(member.device_id::text)::uuid
      FROM unnest(w.path[array_position(w.path, w.next_device_id):]) AS member(device_id)
      WHERE NOT EXISTS (
        SELECT 1 FROM quarantine_reviews q
        WHERE q.device_id = member.device_id AND q.day = w.day
          AND q.provider = w.provider AND q.model = w.model
      )
    ) END AS owner_device_id
  FROM walk w
  WHERE w.next_device_id IS NULL OR w.next_device_id = ANY(w.path)
), repaired AS (
  UPDATE usage_days u
  SET
    duplicate_of_device_id = CASE WHEN o.owner_device_id = u.device_id THEN NULL ELSE o.owner_device_id END,
    trust_level = CASE
      WHEN o.owner_device_id <> u.device_id OR u.trust_level = 'quarantined' THEN u.trust_level
      WHEN u.receipt_count = 0 OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(u.quarantine_reasons) AS r(reason)
        WHERE r.reason->>'code' <> 'duplicate_of_device'
      ) THEN 'reported'::trust_level
      ELSE 'verified'::trust_level
    END,
    quarantine_reasons = CASE WHEN o.owner_device_id <> u.device_id THEN u.quarantine_reasons ELSE COALESCE((
      SELECT jsonb_agg(r.reason ORDER BY r.position)
      FROM jsonb_array_elements(u.quarantine_reasons) WITH ORDINALITY AS r(reason, position)
      WHERE r.reason->>'code' <> 'duplicate_of_device'
    ), '[]'::jsonb) END
  FROM owners o
  WHERE u.device_id = o.start_device_id AND u.builder_id = o.builder_id
    AND u.day = o.day AND u.provider = o.provider AND u.model = o.model
    AND o.owner_device_id IS NOT NULL
    AND u.duplicate_of_device_id IS DISTINCT FROM
      CASE WHEN o.owner_device_id = u.device_id THEN NULL ELSE o.owner_device_id END
    AND NOT EXISTS (
      SELECT 1 FROM quarantine_reviews q
      WHERE q.device_id = u.device_id AND q.day = u.day
        AND q.provider = u.provider AND q.model = u.model
    )
  RETURNING u.device_id, u.builder_id, u.day, u.provider, u.model
)
INSERT INTO dedup_repaired_usage SELECT * FROM repaired;
--> statement-breakpoint
-- Rebuild all restored and repaired days with the same rules as Sync.
-- Mint columns and ledger entries retain their values.
UPDATE builder_days b
SET
  cost_usd = COALESCE(agg.cost_usd, 0),
  total_tokens = COALESCE(agg.total_tokens, 0),
  trust_level_min = COALESCE(agg.trust_level_min, 'reported'::trust_level),
  updated_at = now()
FROM (
  SELECT builder_id, day FROM restored_usage
  UNION
  SELECT builder_id, day FROM dedup_repaired_usage
) d
CROSS JOIN LATERAL (
  SELECT ROUND(SUM(u.cost_usd), 6) AS cost_usd,
    SUM(u.input_tokens + u.cached_input_tokens + u.cache_write_tokens + u.output_tokens + u.reasoning_tokens) AS total_tokens,
    MAX(u.trust_level) AS trust_level_min
  FROM usage_days u
  WHERE u.builder_id = d.builder_id AND u.day = d.day
    AND u.duplicate_of_device_id IS NULL
) agg
WHERE b.builder_id = d.builder_id AND b.day = d.day;
