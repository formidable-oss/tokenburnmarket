/*
  Shaping stored Usage into what a profile shows: a dense run of days, and
  totals by provider and by model.

  Pure on purpose. The query layer decides which rows a viewer is allowed to
  see; this file only adds numbers up, so both are easy to be sure about.
*/
import { weakestTrustLevel } from "@tokenburnmarket/core";
import type { TrustLevel } from "@tokenburnmarket/core";

export interface UsageRow {
  day: string;
  provider: string;
  model: string;
  costUsd: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  trustLevel: TrustLevel;
}

export interface UsageDayPoint {
  day: string;
  costUsd: number;
}

export interface UsageGroup {
  provider: string;
  /** Empty on a provider total, set on a model total. */
  model: string;
  costUsd: number;
  tokens: number;
  trustLevel: TrustLevel;
}

export interface UsageSummary {
  /** One point per day in the window, oldest first, zeros included. */
  days: UsageDayPoint[];
  byProvider: UsageGroup[];
  byModel: UsageGroup[];
  totalCostUsd: number;
  totalTokens: number;
  /** The rows a viewer other than the owner never sees. */
  quarantined: UsageRow[];
}

export function tokensIn(row: UsageRow): number {
  return (
    row.inputTokens +
    row.cachedInputTokens +
    row.cacheWriteTokens +
    row.outputTokens +
    row.reasoningTokens
  );
}

/** The `count` UTC days ending on the day of `end`, oldest first. */
export function dayRange(end: Date, count: number): string[] {
  const last = Date.parse(`${end.toISOString().slice(0, 10)}T00:00:00.000Z`);
  return Array.from({ length: count }, (_, i) =>
    new Date(last - (count - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  );
}

/** Totals by provider, or by provider and model. Heaviest first, which is the only order worth reading. */
function group(rows: readonly UsageRow[], byModel: boolean): UsageGroup[] {
  const buckets = new Map<string, UsageRow[]>();
  for (const row of rows) {
    const id = byModel ? `${row.provider} ${row.model}` : row.provider;
    const bucket = buckets.get(id);
    if (bucket) bucket.push(row);
    else buckets.set(id, [row]);
  }

  return [...buckets.values()]
    .map((bucket) => ({
      provider: bucket[0]!.provider,
      model: byModel ? bucket[0]!.model : "",
      costUsd: round(bucket.reduce((sum, row) => sum + row.costUsd, 0)),
      tokens: bucket.reduce((sum, row) => sum + tokensIn(row), 0),
      trustLevel: weakestTrustLevel(bucket.map((row) => row.trustLevel)),
    }))
    .sort((a, b) => b.costUsd - a.costUsd);
}

/** Cost is stored to six decimals; sums are rounded back so they add up on screen. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function summarizeUsage(rows: readonly UsageRow[], days: readonly string[]): UsageSummary {
  const counted = rows.filter((row) => row.trustLevel !== "quarantined");
  const byDay = new Map(days.map((day) => [day, 0]));
  for (const row of counted) {
    const current = byDay.get(row.day);
    if (current !== undefined) byDay.set(row.day, current + row.costUsd);
  }

  return {
    days: days.map((day) => ({ day, costUsd: round(byDay.get(day) ?? 0) })),
    byProvider: group(counted, false),
    byModel: group(counted, true),
    totalCostUsd: round(counted.reduce((sum, row) => sum + row.costUsd, 0)),
    totalTokens: counted.reduce((sum, row) => sum + tokensIn(row), 0),
    quarantined: rows.filter((row) => row.trustLevel === "quarantined"),
  };
}
