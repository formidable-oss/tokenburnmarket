/*
  Database reads for Markets. Kept out of lib/markets.ts so the pure rules stay
  testable without a database, and out of the pages so a query is written once.

  Prices are never stored. They are `lmsrPrices` over the shares outstanding, so
  a list and a Market page always agree, and there is no cache to go stale.
*/
import { lmsrPrices, type MemberSnapshot } from "@tokenburnmarket/core";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db } from "@/db";
import {
  builderDays,
  builders,
  communities,
  devices,
  markets,
  memberships,
  outcomes,
  positions,
  trades,
  usageDays,
  type MarketParams,
} from "@/db/schema";
import { periodRange } from "./leaderboard";
import type { MarketScope, MarketStatus } from "./markets";

export interface OutcomePrice {
  id: string;
  label: string;
  sharesOutstanding: number;
  /** Instantaneous LMSR price, which also reads as the market's probability. */
  price: number;
}

export interface MarketSummary {
  id: string;
  question: string;
  scope: MarketScope;
  status: MarketStatus;
  closesAt: Date;
  /** The LMSR liquidity parameter, fixed at creation. Prices cannot be read without it. */
  b: number;
  communitySlug: string | null;
  communityName: string | null;
  country: string | null;
  outcomes: OutcomePrice[];
}

/** Prices for one book, in `sort` order. Empty in, empty out. */
function priceBook(
  rows: readonly { id: string; label: string; sharesOutstanding: number }[],
  b: number,
): OutcomePrice[] {
  if (rows.length < 2) return rows.map((row) => ({ ...row, price: 0 }));
  const prices = lmsrPrices(
    rows.map((row) => row.sharesOutstanding),
    b,
  );
  return rows.map((row, index) => ({ ...row, price: prices[index] }));
}

/** Loads the books for a set of Markets in one query, then prices each one. */
async function booksFor(marketIds: string[], b: Map<string, number>) {
  const books = new Map<string, OutcomePrice[]>();
  if (marketIds.length === 0) return books;

  const rows = await db
    .select({
      marketId: outcomes.marketId,
      id: outcomes.id,
      label: outcomes.label,
      sharesOutstanding: outcomes.sharesOutstanding,
    })
    .from(outcomes)
    .where(inArray(outcomes.marketId, marketIds))
    .orderBy(asc(outcomes.marketId), asc(outcomes.sort));

  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = grouped.get(row.marketId) ?? [];
    list.push(row);
    grouped.set(row.marketId, list);
  }
  for (const [marketId, list] of grouped) {
    books.set(marketId, priceBook(list, b.get(marketId) ?? 1));
  }
  return books;
}

const marketColumns = {
  id: markets.id,
  question: markets.question,
  scope: markets.scope,
  status: markets.status,
  closesAt: markets.closesAt,
  b: markets.b,
  country: markets.country,
  communitySlug: communities.slug,
  communityName: communities.name,
};

type MarketRow = Omit<MarketSummary, "outcomes">;

async function summarize(rows: MarketRow[]): Promise<MarketSummary[]> {
  const books = await booksFor(
    rows.map((row) => row.id),
    new Map(rows.map((row) => [row.id, row.b])),
  );
  return rows.map((row) => ({ ...row, outcomes: books.get(row.id) ?? [] }));
}

/*
  The Markets a viewer can trade right now: everything global, their country's,
  and the Communities they belong to. A signed-out viewer sees the global ones,
  which is enough to understand what the page is for.
*/
export async function openMarketsFor(
  viewerId: string | null,
  country: string | null,
): Promise<MarketSummary[]> {
  const visible = [eq(markets.scope, "global")];
  if (country) visible.push(and(eq(markets.scope, "country"), eq(markets.country, country))!);
  if (viewerId) {
    visible.push(
      and(
        eq(markets.scope, "community"),
        sql`exists (
          select 1 from ${memberships}
          where ${memberships.communityId} = ${markets.communityId}
            and ${memberships.builderId} = ${viewerId}
        )`,
      )!,
    );
  }

  const rows = await db
    .select(marketColumns)
    .from(markets)
    .leftJoin(communities, eq(communities.id, markets.communityId))
    .where(and(eq(markets.status, "open"), or(...visible)))
    .orderBy(asc(markets.closesAt));

  return summarize(rows);
}

/** A Community's own open Markets, for the panel on /c/:slug. */
export async function openMarketsForCommunity(communityId: string): Promise<MarketSummary[]> {
  const rows = await db
    .select(marketColumns)
    .from(markets)
    .leftJoin(communities, eq(communities.id, markets.communityId))
    .where(and(eq(markets.communityId, communityId), eq(markets.status, "open")))
    .orderBy(asc(markets.closesAt));

  return summarize(rows);
}

export interface MarketDetail extends MarketSummary {
  type: string;
  params: MarketParams;
  opensAt: Date;
  resolvesAt: Date;
  winningOutcomeId: string | null;
}

export async function marketById(id: string): Promise<MarketDetail | null> {
  const [row] = await db
    .select({
      ...marketColumns,
      type: markets.type,
      params: markets.params,
      opensAt: markets.opensAt,
      resolvesAt: markets.resolvesAt,
      winningOutcomeId: markets.winningOutcomeId,
    })
    .from(markets)
    .leftJoin(communities, eq(communities.id, markets.communityId))
    .where(eq(markets.id, id))
    .limit(1);
  if (!row) return null;

  const book = await db
    .select({
      id: outcomes.id,
      label: outcomes.label,
      sharesOutstanding: outcomes.sharesOutstanding,
    })
    .from(outcomes)
    .where(eq(outcomes.marketId, id))
    .orderBy(asc(outcomes.sort));

  return { ...row, outcomes: priceBook(book, row.b) };
}

export interface ViewerPosition {
  outcomeId: string;
  shares: number;
  costBasis: number;
}

/** Only ever called for the viewer themselves: what someone holds is their business. */
export async function positionsIn(marketId: string, builderId: string): Promise<ViewerPosition[]> {
  return db
    .select({
      outcomeId: positions.outcomeId,
      shares: positions.shares,
      costBasis: positions.costBasis,
    })
    .from(positions)
    .where(and(eq(positions.marketId, marketId), eq(positions.builderId, builderId), gt(positions.shares, 0)));
}

export interface TradeRow {
  id: string;
  handle: string;
  outcomeId: string;
  side: "buy" | "sell";
  shares: number;
  credits: number;
  priceAfter: number;
  createdAt: Date;
}

/** How many fills the Market page shows. Enough to read the tape, not a ledger. */
export const TRADE_PAGE_SIZE = 25;

export async function recentTrades(marketId: string, limit = TRADE_PAGE_SIZE): Promise<TradeRow[]> {
  return db
    .select({
      id: trades.id,
      handle: builders.handle,
      outcomeId: trades.outcomeId,
      side: trades.side,
      shares: trades.shares,
      credits: trades.credits,
      priceAfter: trades.priceAfter,
      createdAt: trades.createdAt,
    })
    .from(trades)
    .innerJoin(builders, eq(builders.id, trades.builderId))
    .where(eq(trades.marketId, marketId))
    .orderBy(desc(trades.createdAt), desc(trades.id))
    .limit(limit);
}

export interface PricePoint {
  at: Date;
  outcomeId: string;
  price: number;
}

/*
  The price chart's data: every fill in order, each carrying the price it left
  behind. The Market's own history, so there is no separate time series to keep
  in step with it.
*/
export async function priceHistory(marketId: string, limit = 400): Promise<PricePoint[]> {
  const rows = await db
    .select({ at: trades.createdAt, outcomeId: trades.outcomeId, price: trades.priceAfter })
    .from(trades)
    .where(eq(trades.marketId, marketId))
    .orderBy(desc(trades.createdAt))
    .limit(limit);
  return rows.reverse();
}

/** The Communities a Builder may open a Market in: the ones they are in. */
export async function communitiesForBuilder(builderId: string) {
  return db
    .select({ id: communities.id, slug: communities.slug, name: communities.name })
    .from(memberships)
    .innerJoin(communities, eq(communities.id, memberships.communityId))
    .where(eq(memberships.builderId, builderId))
    .orderBy(asc(communities.name));
}

/** Members decide `b` (ADR 0002), so creation counts them before fixing it. */
export async function memberCount(communityId: string): Promise<number> {
  const [row] = await db
    .select({ members: sql<number>`count(*)::int` })
    .from(memberships)
    .where(eq(memberships.communityId, communityId));
  return row?.members ?? 0;
}

/** Global Markets have no Community to size, so liquidity is counted over everyone. */
export async function builderCount(): Promise<number> {
  const [row] = await db.select({ builders: sql<number>`count(*)::int` }).from(builders);
  return row?.builders ?? 0;
}

export interface FeaturedMarket extends MarketSummary {
  /** Fills so far, which is the only honest measure of "most active" we have. */
  trades: number;
  /** Credits currently staked on this Market, at what people paid. */
  creditsInPlay: number;
}

/*
  The one open Market the landing page shows: the busiest thing a stranger is
  allowed to see, which means global or a public Community. Unlisted Communities
  are reachable only by URL (CONTEXT.md), so their Markets never surface here.

  Busiest is fills, then the soonest close, so a tie goes to the Market that is
  about to matter. Null when nothing is open, and the caller shows the example.
*/
export async function featuredOpenMarket(now = new Date()): Promise<FeaturedMarket | null> {
  const fills = sql<number>`(select count(*) from ${trades} where ${trades.marketId} = ${markets.id})`;

  const [row] = await db
    .select({
      ...marketColumns,
      trades: sql<number>`${fills}::int`,
      creditsInPlay: sql<number>`(
        select coalesce(sum(${positions.costBasis}), 0)
        from ${positions} where ${positions.marketId} = ${markets.id}
      )::double precision`,
    })
    .from(markets)
    .leftJoin(communities, eq(communities.id, markets.communityId))
    .where(
      and(
        eq(markets.status, "open"),
        gt(markets.closesAt, now),
        or(eq(markets.scope, "global"), eq(communities.visibility, "public")),
      ),
    )
    .orderBy(desc(fills), asc(markets.closesAt))
    .limit(1);
  if (!row) return null;

  const book = await db
    .select({
      id: outcomes.id,
      label: outcomes.label,
      sharesOutstanding: outcomes.sharesOutstanding,
    })
    .from(outcomes)
    .where(eq(outcomes.marketId, row.id))
    .orderBy(asc(outcomes.sort));

  return {
    ...row,
    trades: Number(row.trades),
    creditsInPlay: Number(row.creditsInPlay),
    outcomes: priceBook(book, row.b),
  };
}

/** The four numbers under the landing hero. None of them depend on the viewer. */
export interface SiteStats {
  buildersConnected: number;
  weekCostUsd: number;
  openMarkets: number;
  creditsInPlay: number;
}

/*
  Cached for five minutes, like the boards: a stat that is five minutes old is
  still true enough to put under a hero, and the landing page is the one page
  every stranger loads.
*/
export const cachedSiteStats = unstable_cache(
  async (): Promise<SiteStats> => {
    const week = periodRange("week", new Date());

    const [[connected], [burn], [open], [staked]] = await Promise.all([
      db
        .select({ n: sql<number>`count(distinct ${devices.builderId})::int` })
        .from(devices)
        .where(isNull(devices.revokedAt)),
      db
        .select({ cost: sql<number>`coalesce(sum(${builderDays.costUsd}), 0)::double precision` })
        .from(builderDays)
        .where(
          and(
            sql`${builderDays.trustLevelMin} <> 'quarantined'`,
            gte(builderDays.day, week.start!),
            lte(builderDays.day, week.end),
          ),
        ),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(markets)
        .where(and(eq(markets.status, "open"), gt(markets.closesAt, sql`now()`))),
      db
        .select({ credits: sql<number>`coalesce(sum(${positions.costBasis}), 0)::double precision` })
        .from(positions)
        .innerJoin(markets, eq(markets.id, positions.marketId))
        .where(eq(markets.status, "open")),
    ]);

    return {
      buildersConnected: Number(connected?.n ?? 0),
      weekCostUsd: Number(burn?.cost ?? 0),
      openMarkets: Number(open?.n ?? 0),
      creditsInPlay: Number(staked?.credits ?? 0),
    };
  },
  ["site-stats"],
  { revalidate: 300, tags: ["leaderboard"] },
);
/*
  The models a Model Race runs on: the most burnt over the ranking window, in
  scope. Quarantined Usage is left out here as it is everywhere else, so a fake
  day cannot put a model on the board. Empty until anyone has synced.
*/
export async function modelsInPlay(
  limit: number,
  country: string | null = null,
  now: Date = new Date(),
): Promise<string[]> {
  const tokens = sql<number>`coalesce(sum(
    ${usageDays.inputTokens} + ${usageDays.cachedInputTokens} + ${usageDays.cacheWriteTokens}
    + ${usageDays.outputTokens} + ${usageDays.reasoningTokens}
  ), 0)`;

  const rows = await db
    .select({ model: usageDays.model, tokens })
    .from(usageDays)
    .innerJoin(builders, eq(builders.id, usageDays.builderId))
    .where(
      and(
        gte(usageDays.day, rankingSince(now)),
        sql`${usageDays.trustLevel} <> 'quarantined'`,
        country ? eq(builders.country, country) : undefined,
      ),
    )
    .groupBy(usageDays.model)
    .orderBy(desc(tokens))
    .limit(limit);

  return rows.map((row) => row.model);
}

/** A Community as the template forms and the weekly job both need it. */
export interface CommunityForMarkets {
  id: string;
  slug: string;
  name: string;
  ownerId: string;
  membersCanCreate: boolean;
  /** Ranked by recent Usage: a Top Burner names the first few and pools the rest. */
  members: MemberSnapshot[];
}

/** How far back Usage is read when ranking members for a Top Burner. */
export const RANKING_WINDOW_DAYS = 28;

function rankingSince(now: Date): string {
  return new Date(now.getTime() - RANKING_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
}

/*
  Communities with their members already ranked, in one query. Ranking is by
  Usage cost over the last few weeks, because a Top Burner names only the first
  seven members and pools the rest under "someone else": the order decides who
  is worth a price of their own, and recent burn is the honest guess.
*/
export async function communitiesForMarkets(
  options: { builderId?: string; now?: Date } = {},
): Promise<CommunityForMarkets[]> {
  const since = rankingSince(options.now ?? new Date());
  const mine = options.builderId
    ? sql`exists (
        select 1 from ${memberships}
        where ${memberships.communityId} = ${communities.id}
          and ${memberships.builderId} = ${options.builderId}
      )`
    : undefined;
  const burn = sql`coalesce(sum(${builderDays.costUsd}), 0)`;

  const rows = await db
    .select({
      id: communities.id,
      slug: communities.slug,
      name: communities.name,
      ownerId: communities.ownerId,
      membersCanCreate: communities.marketsMembersCanCreate,
      builderId: builders.id,
      handle: builders.handle,
    })
    .from(communities)
    .innerJoin(memberships, eq(memberships.communityId, communities.id))
    .innerJoin(builders, eq(builders.id, memberships.builderId))
    .leftJoin(builderDays, and(eq(builderDays.builderId, builders.id), gte(builderDays.day, since)))
    .where(mine)
    .groupBy(
      communities.id,
      communities.slug,
      communities.name,
      communities.ownerId,
      communities.marketsMembersCanCreate,
      builders.id,
      builders.handle,
    )
    .orderBy(asc(communities.name), desc(burn), asc(builders.handle));

  const grouped = new Map<string, CommunityForMarkets>();
  for (const row of rows) {
    const community = grouped.get(row.id) ?? { ...row, members: [] };
    community.members.push({ builderId: row.builderId, handle: row.handle });
    grouped.set(row.id, community);
  }
  return [...grouped.values()];
}
