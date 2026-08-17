/*
  Database reads for Leaderboards.

  Every board is the same query with a different scope predicate: the world, a
  continent, a country, or a Community. It reads `builder_days`, the Builder-day
  rollup, so a board never touches per-Device rows, and it joins the Credit
  ledger for the credits-won metric.

  Boards are public, so nothing here depends on the viewer and the result is
  safe to cache. `cachedBoard` holds one for five minutes.
*/
import { and, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db } from "@/db";
import { builderDays, builders, creditLedger, memberships } from "@/db/schema";
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

/**
 * Credits won over a Season: what Markets paid out plus what selling shares
 * returned, less what buying them cost. Minting and the signup grant are not
 * winnings, so they are not in it.
 *
 * Markets land in a later ticket, so today every Builder scores zero. This is
 * the one place the definition lives, so that ticket inherits it rather than
 * inventing a second one.
 */
const creditsWonSum = sql<number>`(
  coalesce(sum(case when ${creditLedger.reason} in ('payout', 'sell') then ${creditLedger.delta} else 0 end), 0)
  - coalesce(sum(case when ${creditLedger.reason} = 'buy' then abs(${creditLedger.delta}) else 0 end), 0)
)::double precision`;

/** A day range as the half-open timestamp window the ledger is stamped in. */
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

  const won = db.$with("won").as(
    db
      .select({
        builderId: creditLedger.builderId,
        creditsWon: creditsWonSum.as("credits_won"),
      })
      .from(creditLedger)
      .where(
        and(
          inArray(creditLedger.reason, ["payout", "sell", "buy"]),
          window.from ? gte(creditLedger.createdAt, new Date(window.from)) : undefined,
          sql`${creditLedger.createdAt} < ${window.until}`,
        ),
      )
      .groupBy(creditLedger.builderId),
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
  Five minutes of staleness on a board nobody is refreshing by hand, and the
  same entry serves every anonymous reader. The Season is resolved inside, so
  the clock is not part of the key; a board can be up to five minutes late
  across a Season boundary, which no one will notice on a Monday morning.
*/
export const cachedBoard = unstable_cache(
  (request: BoardRequest) => board(request),
  ["leaderboard-board"],
  { revalidate: 300, tags: ["leaderboard"] },
);
