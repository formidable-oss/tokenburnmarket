/*
  Leaderboard shaping: which days a Season covers, and how a set of Builders
  becomes a ranked board.

  Pure on purpose. The query layer decides which rows exist and who is in scope;
  this file only orders them, so the ranking can be checked against SQL without
  a database in the loop.
*/

/** A Season (CONTEXT.md): this week (Mon-Sun UTC), this month, or all-time. */
export type Period = "week" | "month" | "all";

export const PERIODS: Period[] = ["week", "month", "all"];

/** What a board ranks by. */
export type Metric = "cost" | "tokens" | "credits";

export const METRICS: Metric[] = ["cost", "tokens", "credits"];

export const PERIOD_LABELS: Record<Period, string> = {
  week: "this week",
  month: "this month",
  all: "all time",
};

export const METRIC_LABELS: Record<Metric, string> = {
  cost: "cost",
  tokens: "tokens",
  credits: "credits won",
};

export function isPeriod(value: unknown): value is Period {
  return typeof value === "string" && (PERIODS as string[]).includes(value);
}

export function isMetric(value: unknown): value is Metric {
  return typeof value === "string" && (METRICS as string[]).includes(value);
}

/**
 * The Season and metric a URL asks for. Anything unrecognised falls back to the
 * defaults rather than 404ing, because a board is a link people edit by hand.
 */
export function parseBoardQuery(params: Record<string, string | string[] | undefined>): {
  period: Period;
  metric: Metric;
} {
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  const period = first(params.period);
  const metric = first(params.metric);
  return {
    period: isPeriod(period) ? period : "week",
    metric: isMetric(metric) ? metric : "cost",
  };
}

/** An inclusive run of UTC days. `start` is null only for all-time. */
export interface DayRange {
  start: string | null;
  end: string;
}

function toDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function utcMidnight(date: Date): number {
  return Date.parse(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

const DAY_MS = 86_400_000;

/*
  The Season containing `now`, whole. A week runs Monday to Sunday UTC and a
  month is the calendar month, so `end` can be in the future; there is no Usage
  there, which keeps the boundary a property of the calendar and not of the clock.
*/
export function periodRange(period: Period, now: Date): DayRange {
  if (period === "all") return { start: null, end: toDay(utcMidnight(now)) };

  if (period === "week") {
    const today = utcMidnight(now);
    // getUTCDay is Sunday-first; the Season is Monday-first.
    const offset = (new Date(today).getUTCDay() + 6) % 7;
    const monday = today - offset * DAY_MS;
    return { start: toDay(monday), end: toDay(monday + 6 * DAY_MS) };
  }

  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return {
    start: toDay(Date.UTC(year, month, 1)),
    end: toDay(Date.UTC(year, month + 1, 0)),
  };
}

/** The Season before the one containing `now`, or null when there is none (all-time). */
export function previousPeriodRange(period: Period, now: Date): DayRange | null {
  if (period === "all") return null;
  const current = periodRange(period, now);
  const start = Date.parse(`${current.start}T00:00:00.000Z`);
  if (period === "week") {
    return { start: toDay(start - 7 * DAY_MS), end: toDay(start - DAY_MS) };
  }
  return periodRange("month", new Date(start - DAY_MS));
}

/** One Builder's totals over a Season, before ranking. */
export interface BoardEntry {
  builderId: string;
  handle: string;
  avatarUrl: string | null;
  costUsd: number;
  totalTokens: number;
  creditsWon: number;
  /** True when any counted day in the Season was Reported rather than Verified. */
  reported: boolean;
}

export interface BoardRow extends BoardEntry {
  rank: number;
  /** The metric the row was ranked by, so the table renders one number. */
  value: number;
  /**
   * Places gained since the previous Season, or null when the Builder was not
   * on the previous board at all. Null on all-time, which has no predecessor.
   */
  rankChange: number | null;
}

export function metricValue(entry: BoardEntry, metric: Metric): number {
  if (metric === "cost") return entry.costUsd;
  if (metric === "tokens") return entry.totalTokens;
  return entry.creditsWon;
}

function sortEntries(entries: readonly BoardEntry[], metric: Metric): BoardEntry[] {
  return [...entries].sort((a, b) => {
    const difference = metricValue(b, metric) - metricValue(a, metric);
    return difference !== 0 ? difference : a.handle.localeCompare(b.handle);
  });
}

/*
  Standard competition ranking: equal values share a rank and the next rank
  skips. Ties break on handle so a board is stable between two identical reads,
  which matters most on the credits board while every value is still zero.
*/
function ranked(entries: readonly BoardEntry[], metric: Metric): Map<string, number> {
  const ranks = new Map<string, number>();
  let rank = 0;
  let previousValue: number | null = null;
  sortEntries(entries, metric).forEach((entry, index) => {
    const value = metricValue(entry, metric);
    if (previousValue === null || value !== previousValue) {
      rank = index + 1;
      previousValue = value;
    }
    ranks.set(entry.builderId, rank);
  });
  return ranks;
}

/**
 * Ranks a Season's entries. `previous` is the same query over the previous
 * Season; a Builder missing from it reads as new to the board rather than as a
 * fall, because the previous board is only fetched down to the same depth.
 */
export function rankEntries(
  entries: readonly BoardEntry[],
  metric: Metric,
  previous?: readonly BoardEntry[],
): BoardRow[] {
  const ranks = ranked(entries, metric);
  const previousRanks = previous ? ranked(previous, metric) : null;

  return sortEntries(entries, metric).map((entry) => {
    const rank = ranks.get(entry.builderId)!;
    const before = previousRanks?.get(entry.builderId);
    return {
      ...entry,
      rank,
      value: metricValue(entry, metric),
      rankChange: before === undefined ? null : before - rank,
    };
  });
}
