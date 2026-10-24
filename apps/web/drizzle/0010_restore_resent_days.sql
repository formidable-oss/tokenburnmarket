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
-- A machine that connects again becomes a new Device and uploads its history
-- a second time. Rows with a Receipt Stream were matched to the first Device
-- then; rows without one (Codex days before receipts were read from
-- compressed rollouts, OpenCode, Pi) were not, so restoring them would count
-- the day twice. Mark a restored row without receipts as the duplicate of an
-- older Device's counted row for the same day and model when output and input
-- agree within the Sync's 90% overlap tolerance.
UPDATE usage_days u
SET
  trust_level = 'reported'::trust_level,
  duplicate_of_device_id = twin.device_id,
  quarantine_reasons = u.quarantine_reasons || '[{"code": "duplicate_of_device", "message": "Another device of yours already reported these messages, so this day is not counted twice."}]'::jsonb
FROM restored_usage x
JOIN usage_days r ON r.device_id = x.device_id
  AND r.day = x.day
  AND r.provider = x.provider
  AND r.model = x.model
JOIN devices mine ON mine.id = x.device_id
CROSS JOIN LATERAL (
  SELECT o.device_id
  FROM usage_days o
  JOIN devices older ON older.id = o.device_id
  WHERE o.builder_id = r.builder_id
    AND o.device_id <> r.device_id
    AND o.day = r.day
    AND o.provider = r.provider
    AND o.model = r.model
    AND o.duplicate_of_device_id IS NULL
    AND older.created_at < mine.created_at
    AND LEAST(o.output_tokens, r.output_tokens) >= 0.9 * GREATEST(o.output_tokens, r.output_tokens)
    AND LEAST(
      o.input_tokens + o.cached_input_tokens + o.cache_write_tokens,
      r.input_tokens + r.cached_input_tokens + r.cache_write_tokens
    ) >= 0.9 * GREATEST(
      o.input_tokens + o.cached_input_tokens + o.cache_write_tokens,
      r.input_tokens + r.cached_input_tokens + r.cache_write_tokens
    )
  ORDER BY older.created_at
  LIMIT 1
) twin
WHERE u.device_id = r.device_id
  AND u.day = r.day
  AND u.provider = r.provider
  AND u.model = r.model
  AND r.receipt_count = 0
  AND r.duplicate_of_device_id IS NULL;
--> statement-breakpoint
-- Rebuild every touched Builder-day the way the Sync rollup does: duplicates
-- left out, the weakest Trust Level carried up, an empty day Reported.
UPDATE builder_days b
SET
  cost_usd = COALESCE(agg.cost_usd, 0),
  total_tokens = COALESCE(agg.total_tokens, 0),
  trust_level_min = COALESCE(agg.trust_level_min, 'reported'::trust_level),
  updated_at = now()
FROM (SELECT DISTINCT builder_id, day FROM restored_usage) d
CROSS JOIN LATERAL (
  SELECT
    ROUND(SUM(u.cost_usd), 6) AS cost_usd,
    SUM(u.input_tokens + u.cached_input_tokens + u.cache_write_tokens + u.output_tokens + u.reasoning_tokens) AS total_tokens,
    MAX(u.trust_level) AS trust_level_min
  FROM usage_days u
  WHERE u.builder_id = d.builder_id
    AND u.day = d.day
    AND u.duplicate_of_device_id IS NULL
) agg
WHERE b.builder_id = d.builder_id
  AND b.day = d.day;
