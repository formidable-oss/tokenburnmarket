/*
  The Drizzle half of the Sync store. No decisions live here, only statements.

  The Neon HTTP driver has no interactive transaction, so a Sync is a sequence
  of idempotent upserts rather than one atomic write. That is deliberate: the
  Collector re-sends today and yesterday on every run, so a Sync interrupted
  halfway is repaired by the next one instead of needing a rollback.
*/
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { builderDays, devices, receipts, usageDays } from "@/db/schema";
import type {
  BuilderDayWrite,
  ReceiptWrite,
  RollupSourceRow,
  SyncStore,
  UsageRowWrite,
} from "./sync";

/*
  Postgres caps parameters per statement at 65535, and a busy day carries tens of
  thousands of receipts. Rows are sized against their column count: receipts have
  four columns, Usage rows sixteen.
*/
const CHUNK = 1000;
const RECEIPT_CHUNK = 5000;

function chunks<T>(items: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export const drizzleSyncStore: SyncStore = {
  async foreignReceipts(builderId, deviceId, hashes) {
    const owners = new Map<string, string>();
    for (const batch of chunks(hashes, RECEIPT_CHUNK)) {
      const rows = await db
        .select({ hash: receipts.hash, deviceId: receipts.deviceId })
        .from(receipts)
        .where(
          and(
            eq(receipts.builderId, builderId),
            ne(receipts.deviceId, deviceId),
            inArray(receipts.hash, batch),
          ),
        );
      for (const row of rows) owners.set(row.hash, row.deviceId);
    }
    return owners;
  },

  async putReceipts(rows: readonly ReceiptWrite[]) {
    for (const batch of chunks(rows, RECEIPT_CHUNK)) {
      await db.insert(receipts).values([...batch]).onConflictDoNothing();
    }
  },

  async putUsageRows(rows: readonly UsageRowWrite[]) {
    for (const batch of chunks(rows)) {
      await db
        .insert(usageDays)
        .values([...batch])
        .onConflictDoUpdate({
          target: [usageDays.deviceId, usageDays.day, usageDays.provider, usageDays.model],
          set: {
            inputTokens: sql`excluded.input_tokens`,
            cachedInputTokens: sql`excluded.cached_input_tokens`,
            cacheWriteTokens: sql`excluded.cache_write_tokens`,
            outputTokens: sql`excluded.output_tokens`,
            reasoningTokens: sql`excluded.reasoning_tokens`,
            costUsd: sql`excluded.cost_usd`,
            trustLevel: sql`excluded.trust_level`,
            quarantineReasons: sql`excluded.quarantine_reasons`,
            receiptCount: sql`excluded.receipt_count`,
            duplicateOfDeviceId: sql`excluded.duplicate_of_device_id`,
            checkedAt: sql`excluded.checked_at`,
          },
        });
    }
  },

  async usageRowsForDays(builderId, days): Promise<RollupSourceRow[]> {
    if (days.length === 0) return [];
    return db
      .select({
        day: usageDays.day,
        costUsd: usageDays.costUsd,
        inputTokens: usageDays.inputTokens,
        cachedInputTokens: usageDays.cachedInputTokens,
        cacheWriteTokens: usageDays.cacheWriteTokens,
        outputTokens: usageDays.outputTokens,
        reasoningTokens: usageDays.reasoningTokens,
        trustLevel: usageDays.trustLevel,
        duplicateOfDeviceId: usageDays.duplicateOfDeviceId,
      })
      .from(usageDays)
      .where(and(eq(usageDays.builderId, builderId), inArray(usageDays.day, [...days])));
  },

  async putBuilderDays(rows: readonly BuilderDayWrite[]) {
    if (rows.length === 0) return;
    // creditsMinted and mintVersion are the mint's columns; a rollup never touches them.
    await db
      .insert(builderDays)
      .values(rows.map((row) => ({ ...row, updatedAt: new Date() })))
      .onConflictDoUpdate({
        target: [builderDays.builderId, builderDays.day],
        set: {
          costUsd: sql`excluded.cost_usd`,
          totalTokens: sql`excluded.total_tokens`,
          trustLevelMin: sql`excluded.trust_level_min`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  },

  async advanceWatermark(deviceId, watermarkDay, syncedAt) {
    await db
      .update(devices)
      .set({ lastSyncedDay: watermarkDay, lastSyncAt: syncedAt })
      .where(eq(devices.id, deviceId));
  },
};
