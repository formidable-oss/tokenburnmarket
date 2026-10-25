/*
  What a Sync does to the database, expressed against a small store interface.

  The route wires the Drizzle implementation; the tests wire an in-memory one.
  Everything that decides anything (Trust Level, cross-device dedupe, the
  machine rule, the rollup, the watermark) lives here and is exercised without
  a database.

  Cross-device dedupe, in one sentence: receipts are stored per Device, and when
  a day arrives from Device B whose Receipt Stream is almost entirely hashes
  another Device of the same Builder already reported, B's row is kept but
  marked as a duplicate and left out of the Builder-day rollup. So two machines
  reading the same transcripts produce two Usage rows and one counted day.

  Receipts expire after `RECEIPT_RETENTION_DAYS`. Each Usage row keeps a SHA256
  fingerprint of its receipt set, so exact copies can still be matched later.
  Only counted Usage rows can own duplicates.

  Devices the Builder marked as one machine count each day once (lib/machines).
*/
import { createHash } from "node:crypto";
import {
  BACKFILL_WINDOW_DAYS,
  checkPlausibility,
  usageDayInputFromSyncDay,
  weakestTrustLevel,
} from "@tokenburnmarket/core";
import type { SyncDay, SyncPayload, TrustLevel } from "@tokenburnmarket/core";
import type { UsageReason } from "@/db/schema";
import {
  DUPLICATE_REASON,
  checkedVerdict,
  duplicateReasons,
  machineVerdicts,
  supersedes,
  type MachineRow,
  type UsageFigures,
  type VerdictUpdate,
} from "./machines";

export { DUPLICATE_REASON } from "./machines";
export type { MachineRow, UsageFigures, VerdictUpdate } from "./machines";

/**
 * How much of a day's Receipt Stream must already belong to another Device
 * before the row is treated as the same work seen twice. Below this, the two
 * Devices genuinely did different work that happens to share some messages,
 * which is possible when a Builder moves a project between machines mid-day.
 */
export const DUPLICATE_OVERLAP_RATIO = 0.9;

/**
 * How many UTC days of Receipt Streams are kept, today included. Covers the
 * days a Collector re-sends on every run and the backfill window behind them,
 * which is everything a Device that has synced before can upload.
 */
export const RECEIPT_RETENTION_DAYS = 7;

/** The oldest UTC day whose receipts are still stored at `now`. */
export function receiptCutoffDay(now: Date): string {
  const cutoff = now.getTime() - (RECEIPT_RETENTION_DAYS - 1) * 86_400_000;
  return new Date(cutoff).toISOString().slice(0, 10);
}

/** How far apart a Sync's `sentAt` and the server clock may be. */
export const SYNC_CLOCK_SKEW_MS = 10 * 60 * 1000;

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
  receiptFingerprint: string | null;
  duplicateOfDeviceId: string | null;
  checkedAt: Date;
}

export interface ReceiptWrite {
  deviceId: string;
  builderId: string;
  day: string;
  hash: string;
}

/** Another Device's Usage row, as the dedupe for days past receipt retention reads it. */
export interface UsageTwin extends UsageFigures {
  deviceId: string;
  day: string;
  provider: string;
  model: string;
  receiptFingerprint: string | null;
  duplicateOfDeviceId: string | null;
}

/** A Usage row this Device already uploaded, as a re-send reads it. */
export interface StoredUsage extends UsageFigures {
  day: string;
  provider: string;
  model: string;
  trustLevel: TrustLevel;
  quarantineReasons: UsageReason[];
  receiptFingerprint: string | null;
  duplicateOfDeviceId: string | null;
  checkedAt: Date;
  /** The latest Admin decision on this Quarantined row was to keep it out. */
  keptOut: boolean;
}

/** A receipt another Device already reported, with the counted Usage row it sits under. */
export interface ForeignReceipt {
  hash: string;
  deviceId: string;
  day: string;
  provider: string;
  model: string;
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

export type ReceiptOwners = Map<string, Set<string>>;

export interface SyncStore {
  /**
   * Each row's receipts that sit on another Device's counted row for the same
   * day and model, for all `rows` at once. Duplicate rows cannot suppress their
   * counted owner on a later Sync.
   */
  foreignReceipts(
    builderId: string,
    deviceId: string,
    rows: readonly Pick<SyncDay, "day" | "provider" | "model" | "receipts">[],
  ): Promise<ForeignReceipt[]>;
  putReceipts(rows: readonly ReceiptWrite[]): Promise<void>;
  /** This Builder's Usage rows on `days` from Devices other than `deviceId`. */
  usageTwins(builderId: string, deviceId: string, days: readonly string[]): Promise<UsageTwin[]>;
  /** This Device's own Usage rows on `days`, with the verdict each one got. */
  storedUsage(deviceId: string, days: readonly string[]): Promise<StoredUsage[]>;
  /** The machine a Device reads now (lib/machines), or null when the Device is gone. */
  machineOf(deviceId: string): Promise<string | null>;
  /** This Builder's Devices on machine `machineId`. */
  machineMembers(builderId: string, machineId: string): Promise<string[]>;
  /** The machines a Builder's Devices are on. */
  builderMachines(builderId: string): Promise<string[]>;
  /** The Usage rows of `deviceIds` on `days`, or on every day when `days` is null. */
  usageOfDevices(deviceIds: readonly string[], days: readonly string[] | null): Promise<MachineRow[]>;
  putUsageRows(rows: readonly UsageRowWrite[]): Promise<void>;
  /** Rewrite the verdict columns of rows that already exist. */
  putVerdicts(rows: readonly VerdictUpdate[]): Promise<void>;
  usageRowsForDays(builderId: string, days: readonly string[]): Promise<RollupSourceRow[]>;
  putBuilderDays(rows: readonly BuilderDayWrite[]): Promise<void>;
  advanceWatermark(deviceId: string, watermarkDay: string | null, syncedAt: Date): Promise<void>;
}

/** What recounting a machine needs: its members, their rows, and the rollup. */
export type MachineStore = Pick<
  SyncStore,
  "machineMembers" | "usageOfDevices" | "putVerdicts" | "usageRowsForDays" | "putBuilderDays"
>;

/** A Quarantined row as the restore reads it. */
export interface QuarantinedUsage extends MachineRow {
  builderId: string;
}

/** What putting back retired quarantines needs, on top of recounting machines. */
export interface RestoreStore extends MachineStore, Pick<SyncStore, "builderMachines"> {
  /** Quarantined rows, of one Builder or of all, except the ones an Admin's latest decision kept out. */
  quarantinedUsage(builderId?: string): Promise<QuarantinedUsage[]>;
  /**
   * Builders, one or all, with a Builder-day marked Quarantined although no
   * counted row under it is. That is what a restore leaves when it stops
   * before its recount; a day an Admin kept a row out of is not one.
   */
  buildersWithStaleQuarantinedDays(builderId?: string): Promise<string[]>;
}

/** What the nightly check of Builder-day totals needs. */
export interface ReconcileStore extends Pick<SyncStore, "usageRowsForDays" | "putBuilderDays"> {
  /** Builder-days whose stored totals differ from the counted Usage rows under them. */
  staleBuilderDays(): Promise<{ builderId: string; day: string }[]>;
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
  options: {
    now: Date;
    cutoffDay: string;
    foreign: ReceiptOwners;
    twins: readonly UsageTwin[];
    /** This Device's stored row for the same key, when the re-send replaces it. */
    previous?: StoredUsage;
  },
): Verdict {
  const check = checkPlausibility(usageDayInputFromSyncDay(row), { now: options.now });
  const reasons: UsageReason[] = check.reasons.map((reason) => ({ ...reason }));

  const duplicateOfDeviceId =
    row.day >= options.cutoffDay
      ? duplicateOwner(row.receipts, options.foreign)
      : (twinOwner(row, options.twins) ?? receiptMatchedOwner(row, options.previous, options.twins));
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
  foreign: ReceiptOwners,
): string | null {
  if (hashes.length === 0) return null;

  const byDevice = new Map<string, number>();
  const unique = new Set(hashes);
  for (const hash of unique) {
    for (const owner of foreign.get(hash) ?? []) {
      byDevice.set(owner, (byDevice.get(owner) ?? 0) + 1);
    }
  }
  let winner: string | null = null;
  let best = 0;
  for (const [device, count] of byDevice) {
    if (count > best) {
      winner = device;
      best = count;
    }
  }
  return best / unique.size >= DUPLICATE_OVERLAP_RATIO ? winner : null;
}

/** Receipt order and repeated identifiers do not change the receipt set. */
export function receiptFingerprint(hashes: readonly string[]): string | null {
  if (hashes.length === 0) return null;
  return createHash("sha256").update([...new Set(hashes)].sort().join("")).digest("hex");
}

function figuresOf(row: SyncDay): UsageFigures {
  return {
    inputTokens: row.inputTokens,
    cachedInputTokens: row.cachedInputTokens,
    cacheWriteTokens: row.cacheWriteTokens,
    outputTokens: row.outputTokens,
    reasoningTokens: row.reasoningTokens,
    costUsd: row.costUsd,
    receiptCount: row.receipts.length,
  };
}

/** Exact equality. Cost is compared at the six decimals it is stored to. */
function sameFigures(a: UsageFigures, b: UsageFigures): boolean {
  return (
    Math.round(a.costUsd * 1e6) === Math.round(b.costUsd * 1e6) &&
    a.inputTokens === b.inputTokens &&
    a.cachedInputTokens === b.cachedInputTokens &&
    a.cacheWriteTokens === b.cacheWriteTokens &&
    a.outputTokens === b.outputTokens &&
    a.reasoningTokens === b.reasoningTokens &&
    a.receiptCount === b.receiptCount
  );
}

/**
 * Historical matches require the same receipt set on a counted row. Rows
 * stored before fingerprints existed have none; for those, only an exact copy
 * of every figure, receipt count included, is the same work. Similar totals
 * are not duplicate evidence, and neither is a row without receipts.
 */
function twinOwner(row: SyncDay, twins: readonly UsageTwin[]): string | null {
  const fingerprint = receiptFingerprint(row.receipts);
  if (fingerprint === null) return null;
  const figures = figuresOf(row);
  const twin = twins.find(
    (other) =>
      other.day === row.day &&
      other.provider === row.provider &&
      other.model === row.model &&
      other.duplicateOfDeviceId === null &&
      (other.receiptFingerprint === null
        ? sameFigures(other, figures)
        : other.receiptFingerprint === fingerprint),
  );
  return twin?.deviceId ?? null;
}

/**
 * Past the receipt window a re-send cannot be matched again, so the receipt
 * match its stored row got while the receipts existed still holds, as long as
 * the row it copied still counts and nothing shows the receipt set changed.
 * Without this, `sync --all` with a slightly larger reading would make an old
 * copy count a second time.
 */
function receiptMatchedOwner(
  row: SyncDay,
  previous: StoredUsage | undefined,
  twins: readonly UsageTwin[],
): string | null {
  const owner = previous?.duplicateOfDeviceId ?? null;
  if (owner === null || !previous!.quarantineReasons.some((reason) => reason.code === DUPLICATE_REASON.code)) {
    return null;
  }
  const fingerprint = receiptFingerprint(row.receipts);
  if (fingerprint !== null && previous!.receiptFingerprint !== null && fingerprint !== previous!.receiptFingerprint) {
    return null;
  }
  const counted = twins.some(
    (other) =>
      other.deviceId === owner &&
      other.day === row.day &&
      other.provider === row.provider &&
      other.model === row.model &&
      other.duplicateOfDeviceId === null,
  );
  return counted ? owner : null;
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

function usageKey(row: { day: string; provider: string; model: string }): string {
  return JSON.stringify([row.day, row.provider, row.model]);
}

/**
 * The oldest day a Sync from this Device replaces outright, or null before its
 * first Sync. Older stored rows change only when a reading supersedes them.
 */
export function backfillFloor(watermarkDay: string | null): string | null {
  if (watermarkDay === null) return null;
  const floor = Date.parse(`${watermarkDay}T00:00:00.000Z`) - BACKFILL_WINDOW_DAYS * 86_400_000;
  return new Date(floor).toISOString().slice(0, 10);
}

/**
 * Whether a re-sent row leaves the stored one as it is.
 *
 * Inside the backfill window the latest reading replaces what is stored: today
 * is still being written. Past the window it replaces the stored row only when
 * it supersedes it (lib/machines). So a re-sync adds missing days, raises days,
 * and corrects estimates, but a machine that lost part of its history cannot
 * lower what it reported before. Age alone never holds a row back.
 *
 * A row an Admin kept out stays out. An incomplete collection (`onlyIfMissing`)
 * may fill a missing row, or refresh one without receipts inside the window,
 * but never replaces stored evidence.
 */
function keepsStored(row: SyncDay, stored: StoredUsage, floor: string | null): boolean {
  if (stored.keptOut) return true;
  const pastFloor = floor !== null && row.day < floor;
  if (row.onlyIfMissing) return pastFloor || stored.receiptCount > 0;
  return pastFloor && !supersedes(figuresOf(row), stored);
}

function storedAsMachineRow(deviceId: string, row: StoredUsage): MachineRow {
  return {
    deviceId,
    day: row.day,
    provider: row.provider,
    model: row.model,
    inputTokens: row.inputTokens,
    cachedInputTokens: row.cachedInputTokens,
    cacheWriteTokens: row.cacheWriteTokens,
    outputTokens: row.outputTokens,
    reasoningTokens: row.reasoningTokens,
    costUsd: row.costUsd,
    receiptCount: row.receiptCount,
    trustLevel: row.trustLevel,
    quarantineReasons: row.quarantineReasons,
    duplicateOfDeviceId: row.duplicateOfDeviceId,
    checkedAt: row.checkedAt,
  };
}

/** Rows grouped by (day, provider, model). */
function byUsageKey<T extends { day: string; provider: string; model: string }>(rows: readonly T[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = usageKey(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
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
  // A row no real usage can produce, such as a day that has not started, is
  // answered and not stored, so it cannot hold a Builder-day out of boards,
  // the mint and market resolution. The Collector sends a day again once it
  // has begun.
  const refused = new Map<string, SyncDayOutcome>();
  for (const row of payload.days) {
    const check = checkPlausibility(usageDayInputFromSyncDay(row), { now });
    if (check.trustLevel !== "quarantined") continue;
    refused.set(usageKey(row), {
      day: row.day,
      provider: row.provider,
      model: row.model,
      trustLevel: "quarantined",
      reasons: check.reasons.map((reason) => ({ ...reason })),
    });
  }
  const accepted = payload.days.filter((row) => !refused.has(usageKey(row)));

  const floor = backfillFloor(device.watermarkDay);
  const days = [...new Set(accepted.map((row) => row.day))];
  const stored = new Map(
    (await store.storedUsage(device.id, days)).map((row) => [usageKey(row), row]),
  );
  const kept = new Map<string, StoredUsage>();
  for (const row of accepted) {
    const existing = stored.get(usageKey(row));
    if (existing && keepsStored(row, existing, floor)) kept.set(usageKey(row), existing);
  }
  const judged = accepted.filter((day) => !kept.has(usageKey(day)));

  const cutoffDay = receiptCutoffDay(now);
  const recent = judged.filter((day) => day.day >= cutoffDay);
  const withReceipts = recent.filter((row) => row.receipts.length > 0);
  const foreignByRow = new Map<string, ReceiptOwners>();
  if (withReceipts.length > 0) {
    for (const receipt of await store.foreignReceipts(device.builderId, device.id, withReceipts)) {
      const owners = foreignByRow.get(usageKey(receipt)) ?? new Map<string, Set<string>>();
      const devices = owners.get(receipt.hash) ?? new Set<string>();
      devices.add(receipt.deviceId);
      owners.set(receipt.hash, devices);
      foreignByRow.set(usageKey(receipt), owners);
    }
  }
  const pastDays = [
    ...new Set(
      judged
        .filter(
          (day) =>
            day.day < cutoffDay &&
            (day.receipts.length > 0 || stored.get(usageKey(day))?.duplicateOfDeviceId != null),
        )
        .map((day) => day.day),
    ),
  ];
  const twins =
    pastDays.length > 0 ? await store.usageTwins(device.builderId, device.id, pastDays) : [];

  // This Device's rows as they stand after the Sync, kept or newly judged.
  const own = new Map<string, MachineRow>();
  const usageRows = new Map<string, UsageRowWrite>();
  for (const row of accepted) {
    const key = usageKey(row);
    const existing = kept.get(key);
    if (existing) {
      own.set(key, storedAsMachineRow(device.id, existing));
      continue;
    }

    const verdict = judgeDay(row, {
      now,
      cutoffDay,
      foreign: foreignByRow.get(key) ?? new Map(),
      twins,
      previous: stored.get(key),
    });
    const write: UsageRowWrite = {
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
      receiptFingerprint: receiptFingerprint(row.receipts),
      duplicateOfDeviceId: verdict.duplicateOfDeviceId,
      checkedAt: now,
    };
    usageRows.set(key, write);
    own.set(key, { ...write });
  }

  // One machine counts once: settle each key against the other Devices on it.
  // The machine is read here, not at authentication, so a change made in
  // Settings while this Sync ran is seen as late as possible.
  const verdictUpdates: VerdictUpdate[] = [];
  const machineId = await store.machineOf(device.id);
  const members = machineId === null ? [] : await store.machineMembers(device.builderId, machineId);
  const siblings = members.filter((id) => id !== device.id);
  if (siblings.length > 0) {
      const memberSet = new Set(members);
    const others = byUsageKey(await store.usageOfDevices(siblings, days));
    for (const [key, row] of own) {
      for (const update of machineVerdicts([row, ...(others.get(key) ?? [])], memberSet, now)) {
        const write = update.deviceId === device.id ? usageRows.get(key) : undefined;
        if (write) {
          write.trustLevel = update.trustLevel;
          write.quarantineReasons = update.quarantineReasons;
          write.duplicateOfDeviceId = update.duplicateOfDeviceId;
        } else {
          verdictUpdates.push(update);
        }
        if (update.deviceId === device.id) own.set(key, { ...row, ...update });
      }
    }
  }

  const outcomes: SyncDayOutcome[] = payload.days.map((row) => {
    const answer = refused.get(usageKey(row));
    if (answer) return answer;
    const final = own.get(usageKey(row))!;
    return {
      day: row.day,
      provider: row.provider,
      model: row.model,
      trustLevel: final.trustLevel,
      reasons: final.quarantineReasons,
    };
  });

  const receiptRows: ReceiptWrite[] = [];
  const seen = new Set<string>();
  for (const row of recent) {
    for (const hash of row.receipts) {
      if (seen.has(hash)) continue;
      seen.add(hash);
      receiptRows.push({ deviceId: device.id, builderId: device.builderId, day: row.day, hash });
    }
  }
  if (receiptRows.length > 0) await store.putReceipts(receiptRows);

  if (usageRows.size > 0) await store.putUsageRows([...usageRows.values()]);
  if (verdictUpdates.length > 0) await store.putVerdicts(verdictUpdates);
  const touched = [
    ...new Set([...[...usageRows.values()].map((row) => row.day), ...verdictUpdates.map((row) => row.day)]),
  ].sort();
  if (touched.length > 0) {
    const rows = await store.usageRowsForDays(device.builderId, touched);
    await store.putBuilderDays(rollupBuilderDays(device.builderId, touched, rows));
  }

  // Another Device on this machine may have synced the same days at the same
  // time, each reading before the other wrote. Settling again from what is
  // stored now leaves one counted row per key whichever finishes last.
  if (siblings.length > 0) await settleMachine(store, device.builderId, members, days, now);

  // Settings changed this Device's machine while the Sync ran: moved it, or
  // moved another Device onto it or off it. Rows were settled against the
  // machine as it was, maybe including a Device that has left it since, so
  // every machine of this Builder is counted again.
  const machineAfter = await store.machineOf(device.id);
  const membersAfter =
    machineAfter === null ? [] : await store.machineMembers(device.builderId, machineAfter);
  const sameMachine =
    machineAfter === machineId &&
    membersAfter.length === members.length &&
    membersAfter.every((id) => members.includes(id));
  if (!sameMachine) {
    await regroupMachines(store, device.builderId, await store.builderMachines(device.builderId), now);
  }

  const watermark = nextWatermark(device.watermarkDay, outcomes);
  await store.advanceWatermark(device.id, watermark, now);

  return { days: outcomes, nextWatermark: watermark };
}

/** The machine rule over what is stored for `days`, and the rollup of the days it changed. */
async function settleMachine(
  store: SyncStore,
  builderId: string,
  members: readonly string[],
  days: readonly string[],
  now: Date,
): Promise<void> {
  const memberSet = new Set(members);
  const updates: VerdictUpdate[] = [];
  for (const group of byUsageKey(await store.usageOfDevices(members, days)).values()) {
    updates.push(...machineVerdicts(group, memberSet, now));
  }
  if (updates.length === 0) return;
  await store.putVerdicts(updates);
  const touched = [...new Set(updates.map((row) => row.day))].sort();
  const rows = await store.usageRowsForDays(builderId, touched);
  await store.putBuilderDays(rollupBuilderDays(builderId, touched, rows));
}

/**
 * Recount a Builder's machines after their Devices changed. Every row on each
 * machine in `machineIds` gets the machine rule, and every Builder-day those
 * machines have rows on is rebuilt, changed or not, so running it again after
 * an interrupted run repairs the totals. A Device that left a machine is a
 * machine of its own, so passing both the old and the new machine settles both
 * sides. Returns how many rows changed.
 */
export async function regroupMachines(
  store: MachineStore,
  builderId: string,
  machineIds: readonly string[],
  now: Date,
): Promise<number> {
  const updates: VerdictUpdate[] = [];
  const days = new Set<string>();
  for (const machineId of new Set(machineIds)) {
    const members = await store.machineMembers(builderId, machineId);
    if (members.length === 0) continue;
    const rows = await store.usageOfDevices(members, null);
    const memberSet = new Set(members);
    for (const row of rows) days.add(row.day);
    for (const group of byUsageKey(rows).values()) {
      updates.push(...machineVerdicts(group, memberSet, now));
    }
  }

  if (updates.length > 0) await store.putVerdicts(updates);
  const touched = [...days].sort();
  if (touched.length > 0) {
    const rows = await store.usageRowsForDays(builderId, touched);
    await store.putBuilderDays(rollupBuilderDays(builderId, touched, rows));
  }
  return updates.length;
}

/**
 * Reasons a restore never clears. A row Quarantined for a day that had not
 * started is checked again instead: once its day has begun it passes.
 */
const BLOCKING_REASONS = new Set(["negative_counts"]);

/**
 * Put back Usage that checks which no longer exist had Quarantined: the
 * backfill window, the size ceilings, an incoherent stream. So does a row held
 * for a day that had not started, once that day has begun. Each row gets the
 * verdict today's checks give it, and a duplicate stays a duplicate. A row an
 * Admin kept out stays out.
 *
 * Every Builder this touches has all their machines counted again, which
 * applies the machine rule to the restored rows and rebuilds their days. So
 * does every Builder with a day still marked Quarantined that no counted row
 * holds back, which repairs a run that stopped between its two steps.
 *
 * This runs before every mint rather than once in a migration, so Usage that a
 * server from before ADR 0006 quarantined during a deploy still comes back,
 * and the restored days are minted the same night. `builderId` limits it to
 * one Builder. Returns how many rows came back.
 */
export async function restoreRetiredQuarantines(
  store: RestoreStore,
  now: Date,
  builderId?: string,
): Promise<number> {
  const rows = (await store.quarantinedUsage(builderId)).filter(
    (row) =>
      !row.quarantineReasons.some((reason) => BLOCKING_REASONS.has(reason.code)) &&
      checkedVerdict(row, now).trustLevel !== "quarantined",
  );

  const updates: VerdictUpdate[] = rows.map((row) => {
    const own = checkedVerdict(row, now);
    const key = { deviceId: row.deviceId, day: row.day, provider: row.provider, model: row.model };
    if (row.duplicateOfDeviceId === null) return { ...key, ...own, duplicateOfDeviceId: null };
    return {
      ...key,
      trustLevel: own.trustLevel === "quarantined" ? "quarantined" : "reported",
      quarantineReasons: [...own.quarantineReasons, ...duplicateReasons(row.quarantineReasons)],
      duplicateOfDeviceId: row.duplicateOfDeviceId,
    };
  });
  if (updates.length > 0) await store.putVerdicts(updates);

  const builders = new Set([
    ...rows.map((row) => row.builderId),
    ...(await store.buildersWithStaleQuarantinedDays(builderId)),
  ]);
  for (const id of builders) {
    await regroupMachines(store, id, await store.builderMachines(id), now);
  }
  return updates.length;
}

/**
 * Rebuild every Builder-day whose stored totals no longer match the counted
 * Usage rows under it. The Neon HTTP driver has no transactions, so a Sync, a
 * recount, a review or a restore that stops between writing rows and writing
 * the rollup leaves a day behind. This runs before every mint, so such a day
 * is right again by the next night and is minted on what it is worth. Returns
 * how many days it rebuilt.
 */
export async function reconcileBuilderDays(store: ReconcileStore): Promise<number> {
  const stale = await store.staleBuilderDays();
  const daysByBuilder = new Map<string, string[]>();
  for (const { builderId, day } of stale) {
    daysByBuilder.set(builderId, [...(daysByBuilder.get(builderId) ?? []), day]);
  }
  for (const [builderId, days] of daysByBuilder) {
    const touched = [...new Set(days)].sort();
    const rows = await store.usageRowsForDays(builderId, touched);
    await store.putBuilderDays(rollupBuilderDays(builderId, touched, rows));
  }
  return stale.length;
}

/** Reject a payload whose clock is far from ours: it is either stale or replayed. */
export function isFreshSync(payload: SyncPayload, now: Date): boolean {
  const sentAt = Date.parse(payload.sentAt);
  if (Number.isNaN(sentAt)) return false;
  return Math.abs(now.getTime() - sentAt) <= SYNC_CLOCK_SKEW_MS;
}
