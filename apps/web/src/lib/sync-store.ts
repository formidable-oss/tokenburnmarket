/*
  The Drizzle half of the Sync store. No decisions live here, only statements.

  The Neon HTTP driver has no interactive transaction, so a Sync is a sequence
  of idempotent upserts rather than one atomic write. That is deliberate: the
  Collector re-sends today and yesterday on every run, so a Sync interrupted
  halfway is repaired by the next one instead of needing a rollback.
*/
import { and, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { builderDays, devices, receipts, usageDays } from "@/db/schema";
import type {
  BuilderDayWrite,
  ForeignReceipt,
  MachineRow,
  QuarantinedUsage,
  ReceiptWrite,
  ReconcileStore,
  RestoreStore,
  RollupSourceRow,
  StoredUsage,
  SyncStore,
  UsageRowWrite,
  UsageTwin,
} from "./sync";

/*
  Postgres caps parameters per statement at 65535, and a busy day carries tens of
  thousands of receipts. Rows are sized against their column count: receipts have
  four columns, Usage rows seventeen.
*/
const CHUNK = 1000;
const RECEIPT_CHUNK = 5000;

function chunks<T>(items: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/*
  Whether the latest Admin decision on the current `usage_days` row was `keep`.
  The table names are written out: inside a select list Drizzle prints columns
  without them, and the subquery would then compare quarantine_reviews with
  itself.
*/
const latestDecisionIsKeep = sql`(
  select q.decision
  from quarantine_reviews q
  where q.device_id = "usage_days"."device_id"
    and q.day = "usage_days"."day"
    and q.provider = "usage_days"."provider"
    and q.model = "usage_days"."model"
  order by q.created_at desc
  limit 1
) = 'keep'`;

/** The columns the machine rule reads, for every query that feeds it. */
const machineColumns = {
  deviceId: usageDays.deviceId,
  day: usageDays.day,
  provider: usageDays.provider,
  model: usageDays.model,
  inputTokens: usageDays.inputTokens,
  cachedInputTokens: usageDays.cachedInputTokens,
  cacheWriteTokens: usageDays.cacheWriteTokens,
  outputTokens: usageDays.outputTokens,
  reasoningTokens: usageDays.reasoningTokens,
  costUsd: usageDays.costUsd,
  receiptCount: usageDays.receiptCount,
  trustLevel: usageDays.trustLevel,
  quarantineReasons: usageDays.quarantineReasons,
  duplicateOfDeviceId: usageDays.duplicateOfDeviceId,
  checkedAt: usageDays.checkedAt,
};

export const drizzleSyncStore: SyncStore & RestoreStore & ReconcileStore = {
  async foreignReceipts(builderId, deviceId, rows) {
    /*
      One statement per RECEIPT_CHUNK hashes, however many rows they come from.
      Each row keeps its own (day, provider, model, hashes) condition, so a
      receipt is only reported under the row whose stream it is in.
    */
    const statements: { usage: (typeof rows)[number]; hashes: string[] }[][] = [[]];
    let size = 0;
    for (const usage of rows) {
      for (const hashes of chunks([...new Set(usage.receipts)], RECEIPT_CHUNK)) {
        if (size + hashes.length > RECEIPT_CHUNK && size > 0) {
          statements.push([]);
          size = 0;
        }
        statements.at(-1)!.push({ usage, hashes });
        size += hashes.length;
      }
    }

    const found: ForeignReceipt[] = [];
    for (const parts of statements) {
      if (parts.length === 0) continue;
      const matches = await db
        .select({
          hash: receipts.hash,
          deviceId: receipts.deviceId,
          day: usageDays.day,
          provider: usageDays.provider,
          model: usageDays.model,
        })
        .from(receipts)
        .innerJoin(
          usageDays,
          and(
            eq(usageDays.deviceId, receipts.deviceId),
            eq(usageDays.builderId, receipts.builderId),
            eq(usageDays.day, receipts.day),
            isNull(usageDays.duplicateOfDeviceId),
          ),
        )
        .where(
          and(
            eq(receipts.builderId, builderId),
            ne(receipts.deviceId, deviceId),
            or(
              ...parts.map(({ usage, hashes }) =>
                and(
                  eq(receipts.day, usage.day),
                  eq(usageDays.provider, usage.provider),
                  eq(usageDays.model, usage.model),
                  inArray(receipts.hash, hashes),
                ),
              ),
            ),
          ),
        )
        .orderBy(receipts.deviceId);
      found.push(...matches);
    }
    return found;
  },

  async putReceipts(rows: readonly ReceiptWrite[]) {
    for (const batch of chunks(rows, RECEIPT_CHUNK)) {
      await db.insert(receipts).values([...batch]).onConflictDoNothing();
    }
  },

  async usageTwins(builderId, deviceId, days): Promise<UsageTwin[]> {
    if (days.length === 0) return [];
    return db
      .select({
        deviceId: usageDays.deviceId,
        day: usageDays.day,
        provider: usageDays.provider,
        model: usageDays.model,
        inputTokens: usageDays.inputTokens,
        cachedInputTokens: usageDays.cachedInputTokens,
        cacheWriteTokens: usageDays.cacheWriteTokens,
        outputTokens: usageDays.outputTokens,
        reasoningTokens: usageDays.reasoningTokens,
        costUsd: usageDays.costUsd,
        receiptCount: usageDays.receiptCount,
        receiptFingerprint: usageDays.receiptFingerprint,
        duplicateOfDeviceId: usageDays.duplicateOfDeviceId,
      })
      .from(usageDays)
      .where(
        and(
          eq(usageDays.builderId, builderId),
          ne(usageDays.deviceId, deviceId),
          inArray(usageDays.day, [...days]),
        ),
      )
      .orderBy(usageDays.deviceId);
  },

  async storedUsage(deviceId, days): Promise<StoredUsage[]> {
    if (days.length === 0) return [];
    return db
      .select({
        day: usageDays.day,
        provider: usageDays.provider,
        model: usageDays.model,
        trustLevel: usageDays.trustLevel,
        quarantineReasons: usageDays.quarantineReasons,
        inputTokens: usageDays.inputTokens,
        cachedInputTokens: usageDays.cachedInputTokens,
        cacheWriteTokens: usageDays.cacheWriteTokens,
        outputTokens: usageDays.outputTokens,
        reasoningTokens: usageDays.reasoningTokens,
        costUsd: usageDays.costUsd,
        receiptCount: usageDays.receiptCount,
        receiptFingerprint: usageDays.receiptFingerprint,
        duplicateOfDeviceId: usageDays.duplicateOfDeviceId,
        checkedAt: usageDays.checkedAt,
        keptOut: sql<number>`case when "usage_days"."trust_level" = 'quarantined' and ${latestDecisionIsKeep}
          then 1 else 0 end`.mapWith((value) => Number(value) === 1),
      })
      .from(usageDays)
      .where(and(eq(usageDays.deviceId, deviceId), inArray(usageDays.day, [...days])));
  },

  async machineOf(deviceId) {
    const [row] = await db
      .select({ machineId: devices.machineId })
      .from(devices)
      .where(eq(devices.id, deviceId))
      .limit(1);
    return row?.machineId ?? null;
  },

  async machineMembers(builderId, machineId) {
    const rows = await db
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.builderId, builderId), eq(devices.machineId, machineId)));
    return rows.map((row) => row.id);
  },

  async usageOfDevices(deviceIds, days): Promise<MachineRow[]> {
    if (deviceIds.length === 0 || days?.length === 0) return [];
    return db
      .select(machineColumns)
      .from(usageDays)
      .where(
        and(
          inArray(usageDays.deviceId, [...deviceIds]),
          days === null ? undefined : inArray(usageDays.day, [...days]),
        ),
      );
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
            receiptFingerprint: sql`excluded.receipt_fingerprint`,
            duplicateOfDeviceId: sql`excluded.duplicate_of_device_id`,
            checkedAt: sql`excluded.checked_at`,
          },
          // An Admin may keep a row out after this Sync read it; the decision stands.
          setWhere: sql`not coalesce(${latestDecisionIsKeep}, false)`,
        });
    }
  },

  async quarantinedUsage(builderId): Promise<QuarantinedUsage[]> {
    return db
      .select({ ...machineColumns, builderId: usageDays.builderId })
      .from(usageDays)
      .where(
        and(
          eq(usageDays.trustLevel, "quarantined"),
          builderId === undefined ? undefined : eq(usageDays.builderId, builderId),
          sql`not coalesce(${latestDecisionIsKeep}, false)`,
        ),
      );
  },

  async buildersWithQuarantinedDays(builderId) {
    const rows = await db
      .selectDistinct({ builderId: builderDays.builderId })
      .from(builderDays)
      .where(
        and(
          eq(builderDays.trustLevelMin, "quarantined"),
          builderId === undefined ? undefined : eq(builderDays.builderId, builderId),
        ),
      );
    return rows.map((row) => row.builderId);
  },

  async builderMachines(builderId) {
    const rows = await db
      .selectDistinct({ machineId: devices.machineId })
      .from(devices)
      .where(eq(devices.builderId, builderId));
    return rows.map((row) => row.machineId);
  },

  async putVerdicts(rows) {
    // One statement per chunk: the rows travel as a single JSON parameter. A
    // row an Admin kept out is never let back in, even if the keep landed
    // after the verdict was worked out.
    for (const batch of chunks(rows)) {
      await db.execute(sql`
        update ${usageDays} as u
        set trust_level = x."trustLevel",
          quarantine_reasons = x."quarantineReasons",
          duplicate_of_device_id = x."duplicateOfDeviceId"
        from jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) as x(
          "deviceId" uuid, day date, provider text, model text,
          "trustLevel" trust_level, "quarantineReasons" jsonb, "duplicateOfDeviceId" uuid
        )
        where u.device_id = x."deviceId" and u.day = x.day
          and u.provider = x.provider and u.model = x.model
          and (
            x."trustLevel" = 'quarantined'
            or coalesce((
              select q.decision
              from quarantine_reviews q
              where q.device_id = u.device_id and q.day = u.day
                and q.provider = u.provider and q.model = u.model
              order by q.created_at desc
              limit 1
            ) <> 'keep', true)
          )
      `);
    }
  },

  async staleBuilderDays() {
    const result = await db.execute(sql`
      select coalesce(c.builder_id, b.builder_id) as "builderId", coalesce(c.day, b.day)::text as day
      from (
        select builder_id, day,
          round(sum(cost_usd), 6) as cost_usd,
          sum(input_tokens + cached_input_tokens + cache_write_tokens + output_tokens + reasoning_tokens) as total_tokens,
          max(trust_level) as trust_level_min
        from usage_days
        where duplicate_of_device_id is null
        group by builder_id, day
      ) c
      full join builder_days b on b.builder_id = c.builder_id and b.day = c.day
      where b.builder_id is null
        or (c.builder_id is null
          and (b.cost_usd <> 0 or b.total_tokens <> 0 or b.trust_level_min <> 'reported'))
        or (c.builder_id is not null
          and (b.cost_usd <> c.cost_usd or b.total_tokens <> c.total_tokens
            or b.trust_level_min <> c.trust_level_min))
    `);
    return (result.rows as { builderId: string; day: string }[]).map((row) => ({
      builderId: row.builderId,
      day: row.day,
    }));
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

/** Drop Receipt Streams older than `cutoffDay`. Run daily from the mint job. */
export async function pruneReceipts(cutoffDay: string): Promise<number> {
  const result = await db.delete(receipts).where(lt(receipts.day, cutoffDay));
  return result.rowCount ?? 0;
}
