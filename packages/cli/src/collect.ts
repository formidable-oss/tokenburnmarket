/*
  Turning what this machine knows into the days a Sync uploads.

  ccusage supplies the numbers, the Receipt Streams supply the evidence, and
  this module decides which days to send at all.
*/
import { MAX_RECEIPTS_PER_DAY } from "@tokenburnmarket/core";
import type { SyncDay } from "@tokenburnmarket/core";
import type { UsageAggregate } from "./ccusage.js";
import { receiptKey, type ReceiptIndex } from "./receipts.js";

/**
 * Days before the watermark a Sync still re-sends, so a transcript written late
 * can still amend its day. Matches `backfillWindowDays` in the server's
 * plausibility limits: send more and the day comes back Quarantined.
 */
export const BACKFILL_DAYS = 2;

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function shiftDay(day: string, days: number): string {
  return utcDay(new Date(Date.parse(`${day}T00:00:00.000Z`) + days * 86_400_000));
}

/**
 * The oldest day to collect, or undefined for everything on this machine.
 *
 * Today and yesterday always go up: today is still being written, and yesterday
 * may have gained messages after the last run. Beyond that the watermark rules,
 * minus the backfill window.
 *
 * `--since` can widen the window up to the backfill window and no further once
 * the device has synced. The server keeps what it already has for older days
 * and quarantines any it never saw, so sending them can only cost a review.
 */
export function windowStart(options: {
  now: Date;
  watermarkDay?: string | null;
  sinceDays?: number;
}): string | undefined {
  const yesterday = shiftDay(utcDay(options.now), -1);
  const floor = options.watermarkDay ? shiftDay(options.watermarkDay, -BACKFILL_DAYS) : undefined;
  if (options.sinceDays !== undefined) {
    const asked = shiftDay(utcDay(options.now), -Math.max(0, options.sinceDays));
    const start = asked < yesterday ? asked : yesterday;
    const clamped = floor !== undefined && start < floor ? floor : start;
    return clamped < yesterday ? clamped : yesterday;
  }
  if (floor === undefined) return undefined;
  return floor < yesterday ? floor : yesterday;
}

/**
 * Attach the Receipt Stream for each aggregate and drop the days outside the
 * window. Hashes are sorted so the same machine produces the same bytes twice,
 * and capped so one runaway day cannot make a Sync unbounded.
 */
export function buildSyncDays(
  aggregates: readonly UsageAggregate[],
  receipts: ReceiptIndex,
  options: { now: Date; start?: string },
): SyncDay[] {
  const today = utcDay(options.now);

  const days = aggregates
    .filter((row) => row.day <= today && (options.start === undefined || row.day >= options.start))
    .map((row): SyncDay => {
      const hashes = [...(receipts.get(receiptKey(row.day, row.provider, row.model)) ?? [])]
        .sort()
        .slice(0, MAX_RECEIPTS_PER_DAY);
      return {
        day: row.day,
        provider: row.provider,
        model: row.model,
        inputTokens: row.inputTokens,
        cachedInputTokens: row.cachedInputTokens,
        cacheWriteTokens: row.cacheWriteTokens,
        outputTokens: row.outputTokens,
        reasoningTokens: row.reasoningTokens,
        costUsd: row.costUsd,
        receipts: hashes,
      };
    })
    .sort((a, b) =>
      a.day === b.day
        ? a.provider === b.provider
          ? a.model.localeCompare(b.model)
          : a.provider.localeCompare(b.provider)
        : a.day.localeCompare(b.day),
    );

  return days;
}
