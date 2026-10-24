/*
  One machine counts once (ADR 0006).

  A Device is one connection. A machine connected twice, because its config was
  lost or it was reconnected, has two Devices that read the same transcripts.
  Their receipts expire after a week, so old days cannot be matched by
  evidence. The Builder says which Devices are the same machine, and for each
  (day, provider, model) the machine then counts one row.

  Which row counts follows the rule for a re-sync from one Device: a newer
  reading replaces an older one when it saw at least the same messages, or
  when it reports at least as many tokens. Otherwise the older reading stays,
  because the machine has lost part of that day's history.

  Different machines always add up.
*/
import { MAX_RECEIPTS_PER_DAY, checkPlausibility } from "@tokenburnmarket/core";
import type { TrustLevel } from "@tokenburnmarket/core";
import type { UsageReason } from "@/db/schema";

export const DUPLICATE_REASON: UsageReason = {
  code: "duplicate_of_device",
  message: "Another device of yours already reported these messages, so this day is not counted twice.",
};

export const SAME_MACHINE_REASON: UsageReason = {
  code: "same_machine",
  message: "Another device on this machine reported this day, so it counts once, from the most complete copy.",
};

const DUPLICATE_CODES = new Set([DUPLICATE_REASON.code, SAME_MACHINE_REASON.code]);

/** The reasons that say a row is another row's copy, as opposed to what its own checks found. */
export function duplicateReasons(reasons: readonly UsageReason[]): UsageReason[] {
  return reasons.filter((reason) => DUPLICATE_CODES.has(reason.code));
}

/** The work a Usage row reports. */
export interface UsageFigures {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
  receiptCount: number;
}

export function processedTokens(row: UsageFigures): number {
  return (
    row.inputTokens +
    row.cachedInputTokens +
    row.cacheWriteTokens +
    row.outputTokens +
    row.reasoningTokens
  );
}

/**
 * Whether `next`, a later reading of the same day, replaces `prev`.
 *
 * A reading with at least as many tokens always does. A lower one replaces
 * `prev` only with evidence that the machine still has every message behind
 * it: at least as many receipts. Then the new figures are a corrected estimate
 * of the same work. A stream cut at the per-day cap proves nothing, and a drop
 * to less than half is more likely a reader that missed files than a better
 * estimate. Otherwise what was reported before stays: fewer tokens can mean
 * deleted transcripts.
 */
export function supersedes(next: UsageFigures, prev: UsageFigures): boolean {
  const nextTokens = processedTokens(next);
  const prevTokens = processedTokens(prev);
  if (nextTokens >= prevTokens) return true;
  return (
    prev.receiptCount > 0 &&
    prev.receiptCount < MAX_RECEIPTS_PER_DAY &&
    next.receiptCount >= prev.receiptCount &&
    nextTokens * 2 >= prevTokens
  );
}

/** A stored or about-to-be-stored Usage row, as the machine rule reads it. */
export interface MachineRow extends UsageFigures {
  deviceId: string;
  day: string;
  provider: string;
  model: string;
  trustLevel: TrustLevel;
  quarantineReasons: UsageReason[];
  duplicateOfDeviceId: string | null;
  checkedAt: Date;
}

/** The verdict columns of one Usage row, as the machine rule rewrites them. */
export interface VerdictUpdate {
  deviceId: string;
  day: string;
  provider: string;
  model: string;
  trustLevel: TrustLevel;
  quarantineReasons: UsageReason[];
  duplicateOfDeviceId: string | null;
}

/**
 * Rows the machine rule may move. A row another machine's receipts already
 * cover stays a duplicate of that machine; this one cannot make it count.
 */
function eligible(row: MachineRow, members: ReadonlySet<string>): boolean {
  if (row.duplicateOfDeviceId === null) return true;
  if (row.quarantineReasons.some((reason) => reason.code === SAME_MACHINE_REASON.code)) return true;
  return members.has(row.duplicateOfDeviceId);
}

/** The counted row: readings in the order they arrived, each replacing the last when it supersedes it. */
function pickOwner(rows: readonly MachineRow[]): MachineRow | undefined {
  const ordered = [...rows].sort(
    (a, b) => a.checkedAt.getTime() - b.checkedAt.getTime() || a.deviceId.localeCompare(b.deviceId),
  );
  let owner = ordered[0];
  for (const row of ordered.slice(1)) {
    if (owner && supersedes(row, owner)) owner = row;
  }
  return owner;
}

/** The Trust Level and reasons today's checks give a stored row, as if it were nobody's copy. */
export function checkedVerdict(
  row: Omit<MachineRow, "deviceId" | "trustLevel" | "quarantineReasons" | "duplicateOfDeviceId" | "checkedAt">,
  now: Date,
): { trustLevel: TrustLevel; quarantineReasons: UsageReason[] } {
  const check = checkPlausibility(
    {
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
    },
    { now },
  );
  return { trustLevel: check.trustLevel, quarantineReasons: check.reasons.map((reason) => ({ ...reason })) };
}

function countedState(row: MachineRow, now: Date): Omit<VerdictUpdate, "deviceId" | "day" | "provider" | "model"> {
  if (row.duplicateOfDeviceId === null) {
    return { trustLevel: row.trustLevel, quarantineReasons: row.quarantineReasons, duplicateOfDeviceId: null };
  }
  // A duplicate carries a downgraded level, so its own one is worked out again.
  return { ...checkedVerdict(row, now), duplicateOfDeviceId: null };
}

function duplicateState(row: MachineRow, ownerDeviceId: string): Omit<VerdictUpdate, "deviceId" | "day" | "provider" | "model"> {
  return {
    trustLevel: row.trustLevel === "quarantined" ? "quarantined" : "reported",
    quarantineReasons: [
      ...row.quarantineReasons.filter((reason) => !DUPLICATE_CODES.has(reason.code)),
      SAME_MACHINE_REASON,
    ],
    duplicateOfDeviceId: ownerDeviceId,
  };
}

/**
 * For the rows of one (day, provider, model) on one machine, the verdict
 * changes that leave exactly one of them counted. `members` are the machine's
 * Devices. A Quarantined row never becomes the counted one, but it becomes a
 * duplicate when another row counts, so it no longer holds the day back.
 */
export function machineVerdicts(
  rows: readonly MachineRow[],
  members: ReadonlySet<string>,
  now: Date,
): VerdictUpdate[] {
  const pool = rows.filter((row) => eligible(row, members));
  const owner = pickOwner(pool.filter((row) => row.trustLevel !== "quarantined"));
  if (!owner) return [];

  const updates: VerdictUpdate[] = [];
  for (const row of pool) {
    const next = row === owner ? countedState(row, now) : duplicateState(row, owner.deviceId);
    const unchanged =
      next.trustLevel === row.trustLevel &&
      next.duplicateOfDeviceId === row.duplicateOfDeviceId &&
      JSON.stringify(next.quarantineReasons) === JSON.stringify(row.quarantineReasons);
    if (!unchanged) {
      updates.push({ deviceId: row.deviceId, day: row.day, provider: row.provider, model: row.model, ...next });
    }
  }
  return updates;
}
