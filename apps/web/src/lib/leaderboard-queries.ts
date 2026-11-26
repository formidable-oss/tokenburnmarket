/*
  Database reads for Leaderboards.

  Every board is the same query with a different scope predicate: the world, a
  continent, a country, or a Community. It reads `builder_days`, the Builder-day
  rollup, so a board never touches per-Device rows, and it joins trades on
  settled Markets for the credits-won metric.

  Boards are public, so nothing here depends on the viewer and the result is
  safe to cache. `cachedBoard` holds one for a Sync Slot (ADR 0005).
*/
import { SYNC_SLOT_HOURS } from "@tokenburnmarket/core";
import { and, eq, gte, inArray, isNotNull, lt, lte, or, sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db } from "@/db";
import { builderDays, builders, markets, memberships, trades } from "@/db/schema";
import {
  periodRange,
  previousPeriodRange,
  rankEntries,
  type BoardEntry,
  type BoardRow,
  type DayRange,
  type Metric,
  type Period,
} from "./leaderboard";
import type { Region } from "./regions";

/** How deep a board page goes. Ranks below this are not interesting to anyone. */
export const BOARD_LIMIT = 100;

/** How many rows the landing preview shows. */
export const BOARD_PREVIEW_LIMIT = 8;

/** Which Builders a board considers. Serializable, because it is a cache key. */
export type BoardScope =
  | { kind: "world" }
  | { kind: "countries"; countries: string[] }
  | { kind: "community"; communityId: string };

export function scopeForRegion(region: Region): BoardScope {
  if (region.kind === "world") return { kind: "world" };
  if (region.kind === "continent") return { kind: "countries", countries: region.countries };
  return { kind: "countries", countries: [region.country] };
}

/*
  Credits won over a Season: for every Market due to settle in it (its
  `resolves_at`; a held Market keeps the Season it was due in), what settling paid
  (winnings, or the refund of a voided Market) plus what selling shares raised,
  less what buying them cost. Minting and the signup grant are not winnings.

  It is counted per Market at its settlement time, not per ledger row at its
  own time, because a weekly Market is bought into during one week and paid the
  next: counting rows would show every bettor a loss this week and a windfall
  the next. A stake still riding on an open Market counts for nothing yet.

  Written with table names rather than interpolated columns, because a column in
  a select projection renders unqualified and would bind to the wrong table
  inside the correlated subquery.
*/
const betNetPerMarket = sql<number>`(
  coalesce(sum(case when trades.side = 'sell' then trades.credits else -trades.credits end), 0)
  + coalesce((
    select sum(l.delta) from credit_ledger l
    where l.builder_id = trades.builder_id
      and l.ref_id = 'market:' || markets.id::text
      and l.reason in ('payout', 'refund')
  ), 0)
)::double precision`;

/** A day range as the half-open timestamp window a Market has to settle in. */
function ledgerWindow(range: DayRange): { from: string | null; until: string } {
  const until = new Date(Date.parse(`${range.end}T00:00:00.000Z`) + 86_400_000);
  return {
    from: range.start ? `${range.start}T00:00:00.000Z` : null,
    until: until.toISOString(),
  };
}

/**
 * One Season of a board, ordered by `metric` and cut to `limit`.
 *
 * A Builder is on the board when they burned in the Season or moved Credits on
 * a Market in it. Quarantined days are excluded outright (ADR 0003), which is
 * also why a day that is only Reported still counts, badged.
 */
export async function boardEntries(
  scope: BoardScope,
  range: DayRange,
  metric: Metric,
  limit: number,
): Promise<BoardEntry[]> {
  const window = ledgerWindow(range);

  const burn = db.$with("burn").as(
    db
      .select({
        builderId: builderDays.builderId,
        costUsd: sql<number>`sum(${builderDays.costUsd})::double precision`.as("cost_usd"),
        verifiedCostUsd: sql<number>`sum(${builderDays.verifiedCostUsd})::double precision`.as(
          "verified_cost_usd",
        ),
        totalTokens: sql<number>`sum(${builderDays.totalTokens})::double precision`.as(
          "total_tokens",
        ),
        reported: sql<boolean>`bool_or(${builderDays.trustLevelMin} = 'reported')`.as("reported"),
      })
      .from(builderDays)
      .where(
        and(
          sql`${builderDays.trustLevelMin} <> 'quarantined'`,
          range.start ? gte(builderDays.day, range.start) : undefined,
          lte(builderDays.day, range.end),
        ),
      )
      .groupBy(builderDays.builderId),
  );

  const bet = db
    .select({
      builderId: trades.builderId,
      net: betNetPerMarket.as("net"),
    })
    .from(trades)
    .innerJoin(markets, eq(markets.id, trades.marketId))
    .where(
      and(
        inArray(markets.status, ["resolved", "voided"]),
        window.from ? gte(markets.resolvesAt, new Date(window.from)) : undefined,
        lt(markets.resolvesAt, new Date(window.until)),
      ),
    )
    .groupBy(trades.builderId, markets.id)
    .as("bet");

  const won = db.$with("won").as(
    db
      .select({
        builderId: bet.builderId,
        creditsWon: sql<number>`sum(${bet.net})::double precision`.as("credits_won"),
      })
      .from(bet)
      .groupBy(bet.builderId),
  );

  const value =
    metric === "cost"
      ? sql`coalesce(${burn.costUsd}, 0)`
      : metric === "tokens"
        ? sql`coalesce(${burn.totalTokens}, 0)`
        : sql`coalesce(${won.creditsWon}, 0)`;

  const rows = await db
    .with(burn, won)
    .select({
      builderId: builders.id,
      handle: builders.handle,
      avatarUrl: builders.avatarUrl,
      costUsd: sql<number>`coalesce(${burn.costUsd}, 0)`,
      verifiedCostUsd: sql<number>`coalesce(${burn.verifiedCostUsd}, 0)`,
      totalTokens: sql<number>`coalesce(${burn.totalTokens}, 0)`,
      creditsWon: sql<number>`coalesce(${won.creditsWon}, 0)`,
      reported: sql<boolean>`coalesce(${burn.reported}, false)`,
    })
    .from(builders)
    .leftJoin(burn, eq(burn.builderId, builders.id))
    .leftJoin(won, eq(won.builderId, builders.id))
    .where(and(scopePredicate(scope), or(isNotNull(burn.builderId), isNotNull(won.builderId))))
    .orderBy(sql`${value} desc`, builders.handle)
    .limit(limit);

  return rows.map((row) => ({
    builderId: row.builderId,
    handle: row.handle,
    avatarUrl: row.avatarUrl,
    costUsd: Number(row.costUsd),
    verifiedCostUsd: Number(row.verifiedCostUsd),
    totalTokens: Number(row.totalTokens),
    creditsWon: Number(row.creditsWon),
    reported: Boolean(row.reported),
  }));
}

/*
  A Builder with no country is on the world board and on no country board: the
  Region is self-declared and we do not guess it. A Community board ignores
  Region entirely.
*/
function scopePredicate(scope: BoardScope) {
  if (scope.kind === "world") return undefined;
  if (scope.kind === "countries") return inArray(builders.country, scope.countries);
  return sql`exists (
    select 1 from ${memberships}
    where ${memberships.builderId} = ${builders.id}
      and ${eq(memberships.communityId, scope.communityId)}
  )`;
}

export interface BoardRequest {
  scope: BoardScope;
  period: Period;
  metric: Metric;
  limit?: number;
  /** Off where a rank change would be noise, such as the eight-row landing preview. */
  comparePrevious?: boolean;
}

export interface Board {
  rows: BoardRow[];
  range: DayRange;
  /** Sum of the metric over the rows shown, for the panel header. */
  total: number;
}

/** A board and the same board one Season earlier, so ranks can be compared. */
export async function board(request: BoardRequest, now = new Date()): Promise<Board> {
  const limit = request.limit ?? BOARD_LIMIT;
  const range = periodRange(request.period, now);
  const before =
    request.comparePrevious === false ? null : previousPeriodRange(request.period, now);

  const [entries, previous] = await Promise.all([
    boardEntries(request.scope, range, request.metric, limit),
    before ? boardEntries(request.scope, before, request.metric, limit) : Promise.resolve(undefined),
  ]);

  const rows = rankEntries(entries, request.metric, previous);
  return { rows, range, total: rows.reduce((sum, row) => sum + row.value, 0) };
}

/*
  A board only changes when Syncs land, and automatic Syncs land in Sync Slots,
  so an entry lives for one slot and the sync route marks it stale when new
  Usage arrives. Every cache miss wakes the database, which is what this is
  saving. The Season is resolved inside, so the clock is not part of the key; a
  board can be one slot late across a Season boundary, the same lag as its data.
*/
export const cachedBoard = unstable_cache(
  (request: BoardRequest) => board(request),
  ["leaderboard-board"],
  { revalidate: SYNC_SLOT_HOURS * 3600, tags: ["leaderboard"] },
);
