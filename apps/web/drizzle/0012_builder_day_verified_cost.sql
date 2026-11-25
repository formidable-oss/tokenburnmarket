ALTER TABLE "builder_days" ADD COLUMN "verified_cost_usd" numeric(14, 6) DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Backfill from the counted Usage rows, the same sum the rollup in
-- src/lib/sync.ts writes, so the reconcile job sees no difference afterwards.
UPDATE "builder_days" b
SET "verified_cost_usd" = v.verified_cost_usd
FROM (
  SELECT builder_id, day, round(sum(cost_usd), 6) AS verified_cost_usd
  FROM usage_days
  WHERE duplicate_of_device_id IS NULL AND trust_level = 'verified'
  GROUP BY builder_id, day
) v
WHERE b.builder_id = v.builder_id AND b.day = v.day;
