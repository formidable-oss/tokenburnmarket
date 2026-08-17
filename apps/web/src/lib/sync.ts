/*
  What a Sync does to the database, expressed against a small store interface.

  The route wires the Drizzle implementation; the tests wire an in-memory one.
  Everything that decides anything (Trust Level, cross-device dedupe, the
  rollup, the watermark) lives here and is exercised without a database.

  Cross-device dedupe, in one sentence: receipts are stored per Device, and when
  a day arrives from Device B whose Receipt Stream is almost entirely hashes
  another Device of the same Builder already reported, B's row is kept but
  marked as a duplicate and left out of the Builder-day rollup. So two machines
  reading the same transcripts produce two Usage rows and one counted day.
*/
import {
  checkPlausibility,
  usageDayInputFromSyncDay,
  weakestTrustLevel,
} from "@tokenburnmarket/core";
import type { SyncDay, SyncPayload, TrustLevel } from "@tokenburnmarket/core";
import type { UsageReason } from "@/db/schema";

/**
 * How much of a day's Receipt Stream must already belong to another Device
 * before the row is treated as the same work seen twice. Below this, the two
 * Devices genuinely did different work that happens to share some messages,
 * which is possible when a Builder moves a project between machines mid-day.
 */
export const DUPLICATE_OVERLAP_RATIO = 0.9;

/** How far apart a Sync's `sentAt` and the server clock may be. */
export const SYNC_CLOCK_SKEW_MS = 10 * 60 * 1000;

export const DUPLICATE_REASON: UsageReason = {
  code: "duplicate_of_device",
  message: "Another device of yours already reported these messages, so this day is not counted twice.",
};

export interface SyncDevice {
  id: string;
  builderId: string;
  /** Newest UTC day already accepted for this Device, or null before the first Sync. */
  watermarkDay: string | null;
}

export interface UsageRowWrite {
  deviceId: string;
  builderId: string;
  day: string;
  provider: string;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
  trustLevel: TrustLevel;
  quarantineReasons: UsageReason[];
  receiptCount: number;
  duplicateOfDeviceId: string | null;
  checkedAt: Date;
}

export interface ReceiptWrite {
  deviceId: string;
  builderId: string;
  day: string;
  hash: string;
}

/** The columns the rollup reads back out of `usage_days`. */
export interface RollupSourceRow {
  day: string;
  costUsd: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  trustLevel: TrustLevel;
  duplicateOfDeviceId: string | null;
}

export interface BuilderDayWrite {
  builderId: string;
  day: string;
  costUsd: number;
  totalTokens: number;
  trustLevelMin: TrustLevel;
}

export interface SyncStore {
  /**
   * Of `hashes`, the ones this Builder already has on a *different* Device,
   * mapped to that Device. Asked before the incoming receipts are written, so a
   * Device never sees its own earlier upload as a duplicate.
   */
  foreignReceipts(
    builderId: string,
    deviceId: string,
    hashes: readonly string[],
  ): Promise<Map<string, string>>;
  putReceipts(rows: readonly ReceiptWrite[]): Promise<void>;
  putUsageRows(rows: readonly UsageRowWrite[]): Promise<void>;
  usageRowsForDays(builderId: string, days: readonly string[]): Promise<RollupSourceRow[]>;
  putBuilderDays(rows: readonly BuilderDayWrite[]): Promise<void>;
  advanceWatermark(deviceId: string, watermarkDay: string | null, syncedAt: Date): Promise<void>;
}

export interface SyncDayOutcome {
  day: string;
  provider: string;
  model: string;
  trustLevel: TrustLevel;
  reasons: UsageReason[];
}

export interface SyncResult {
  days: SyncDayOutcome[];
  /** The Device's watermark after this Sync. The Collector stores it and syncs from there. */
  nextWatermark: string | null;
}

/** A verdict for one uploaded row, before it is turned into a database write. */
interface Verdict {
  trustLevel: TrustLevel;
  reasons: UsageReason[];
  duplicateOfDeviceId: string | null;
}

function judgeDay(
  row: SyncDay,
  options: { now: Date; watermarkDay: string | null; foreign: Map<string, string> },
): Verdict {
  const check = checkPlausibility(usageDayInputFromSyncDay(row), {
    now: options.now,
    deviceWatermarkDay: options.watermarkDay ?? undefined,
  });
  const reasons: UsageReason[] = check.reasons.map((reason) => ({ ...reason }));

  const duplicateOfDeviceId = duplicateOwner(row.receipts, options.foreign);
  if (duplicateOfDeviceId === null) {
    return { trustLevel: check.trustLevel, reasons, duplicateOfDeviceId: null };
  }

  reasons.push(DUPLICATE_REASON);
  // A failed check still outranks a duplicate: the row is suspect either way,
  // and Quarantined is the level that gets a human to look at it.
  const trustLevel: TrustLevel = check.trustLevel === "quarantined" ? "quarantined" : "reported";
  return { trustLevel, reasons, duplicateOfDeviceId };
}

/** The Device that already owns most of this stream, or null when the row is new work. */
function duplicateOwner(
  hashes: readonly string[],
  foreign: Map<string, string>,
): string | null {
  if (hashes.length === 0) return null;

  const byDevice = new Map<string, number>();
  let overlap = 0;
  for (const hash of hashes) {
    const owner = foreign.get(hash);
    if (owner === undefined) continue;
    overlap += 1;
    byDevice.set(owner, (byDevice.get(owner) ?? 0) + 1);
  }
  if (overlap / hashes.length < DUPLICATE_OVERLAP_RATIO) return null;

  let winner: string | null = null;
  let best = 0;
  for (const [device, count] of byDevice) {
    if (count > best) {
      winner = device;
      best = count;
    }
  }
  return winner;
}

/**
 * Sum a Builder's day from its Usage rows. Duplicates are skipped; everything
 * else counts, and the weakest Trust Level in the day is carried up so one bad
 * row can be filtered out of Leaderboards without erasing the Usage.
 */
export function rollupBuilderDays(
  builderId: string,
  days: readonly string[],
  rows: readonly RollupSourceRow[],
): BuilderDayWrite[] {
  return days.map((day) => {
    const counted = rows.filter((row) => row.day === day && row.duplicateOfDeviceId === null);
    const costUsd = counted.reduce((sum, row) => sum + row.costUsd, 0);
    const totalTokens = counted.reduce(
      (sum, row) =>
        sum +
        row.inputTokens +
        row.cachedInputTokens +
        row.cacheWriteTokens +
        row.outputTokens +
        row.reasoningTokens,
      0,
    );
    return {
      builderId,
      day,
      // Cost is stored to six decimals; rounding here keeps the sum stable across re-syncs.
      costUsd: Math.round(costUsd * 1e6) / 1e6,
      totalTokens,
      trustLevelMin: weakestTrustLevel(counted.map((row) => row.trustLevel)),
    };
  });
}

/**
 * The watermark only ever moves forward, and only over days that passed their
 * checks: a fabricated future day must not lock a Builder out of backfilling
 * the days behind it.
 */
export function nextWatermark(current: string | null, outcomes: readonly SyncDayOutcome[]): string | null {
  let watermark = current;
  for (const outcome of outcomes) {
    if (outcome.trustLevel === "quarantined") continue;
    if (watermark === null || outcome.day > watermark) watermark = outcome.day;
  }
  return watermark;
}

/**
 * Apply one verified Sync. The caller has already checked the signature and
 * that the payload belongs to this Device.
 *
 * Writes are ordered so a crash halfway leaves the database re-syncable rather
 * than wrong: receipts first, then Usage, then the rollup, then the watermark.
 * Every write is an upsert keyed by what the Collector sent, so the same Sync
 * applied twice lands on the same state.
 */
export async function applySync(
  store: SyncStore,
  device: SyncDevice,
  payload: SyncPayload,
  now: Date,
): Promise<SyncResult> {
  const hashes = [...new Set(payload.days.flatMap((day) => day.receipts))];
  const foreign =
    hashes.length > 0
      ? await store.foreignReceipts(device.builderId, device.id, hashes)
      : new Map<string, string>();

  const outcomes: SyncDayOutcome[] = [];
  const usageRows: UsageRowWrite[] = [];
  for (const row of payload.days) {
    const verdict = judgeDay(row, { now, watermarkDay: device.watermarkDay, foreign });
    outcomes.push({
      day: row.day,
      provider: row.provider,
      model: row.model,
      trustLevel: verdict.trustLevel,
      reasons: verdict.reasons,
    });
    usageRows.push({
      deviceId: device.id,
      builderId: device.builderId,
      day: row.day,
      provider: row.provider,
      model: row.model,
      inputTokens: row.inputTokens,
      cachedInputTokens: row.cachedInputTokens,
      cacheWriteTokens: row.cacheWriteTokens,
      outputTokens: row.outputTokens,
      reasoningTokens: row.reasoningTokens,
      costUsd: row.costUsd,
      trustLevel: verdict.trustLevel,
      quarantineReasons: verdict.reasons,
      receiptCount: row.receipts.length,
      duplicateOfDeviceId: verdict.duplicateOfDeviceId,
      checkedAt: now,
    });
  }

  const receiptRows: ReceiptWrite[] = [];
  const seen = new Set<string>();
  for (const row of payload.days) {
    for (const hash of row.receipts) {
      if (seen.has(hash)) continue;
      seen.add(hash);
      receiptRows.push({ deviceId: device.id, builderId: device.builderId, day: row.day, hash });
    }
  }
  if (receiptRows.length > 0) await store.putReceipts(receiptRows);
  await store.putUsageRows(usageRows);

  const touched = [...new Set(payload.days.map((day) => day.day))].sort();
  const rows = await store.usageRowsForDays(device.builderId, touched);
  await store.putBuilderDays(rollupBuilderDays(device.builderId, touched, rows));

  const watermark = nextWatermark(device.watermarkDay, outcomes);
  await store.advanceWatermark(device.id, watermark, now);

  return { days: outcomes, nextWatermark: watermark };
}

/** Reject a payload whose clock is far from ours: it is either stale or replayed. */
export function isFreshSync(payload: SyncPayload, now: Date): boolean {
  const sentAt = Date.parse(payload.sentAt);
  if (Number.isNaN(sentAt)) return false;
  return Math.abs(now.getTime() - sentAt) <= SYNC_CLOCK_SKEW_MS;
}
