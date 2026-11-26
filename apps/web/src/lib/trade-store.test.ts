/*
  The one test that needs a real database, because what it checks is a database
  guarantee: two trades landing on one Market at the same instant have to
  serialize, and the second has to price against the book the first left.

  It runs against the dev Neon database and skips itself when DATABASE_URL is
  absent, so CI and a fresh clone stay green without one. Everything it creates
  is deleted afterwards.
*/
import { lmsrQuote } from "@tokenburnmarket/core";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// vitest does not read .env.local, and drizzle's config is not loaded here.
try {
  process.loadEnvFile?.(".env.local");
} catch {
  // No env file is the same as no DATABASE_URL: the suite skips.
}

const hasDatabase = Boolean(process.env.DATABASE_URL);
const B = 50;
const STARTING_CREDITS = 1000;

describe.skipIf(!hasDatabase)("executeTrade against the dev database", async () => {
  const { db } = await import("@/db");
  const { builders, creditLedger, markets, outcomes, positions, trades } = await import(
    "@/db/schema"
  );
  const { executeTrade } = await import("./trade-store");

  const marketId = crypto.randomUUID();
  const builderId = crypto.randomUUID();
  const outcomeIds = [crypto.randomUUID(), crypto.randomUUID()];

  beforeAll(async () => {
    const handle = `trade-test-${marketId.slice(0, 8)}`;
    await db.insert(builders).values({ id: builderId, githubId: `test:${builderId}`, handle });
    await db
      .insert(creditLedger)
      .values({ builderId, delta: STARTING_CREDITS, reason: "signup", refId: `test:${builderId}` });
    await db.insert(markets).values({
      id: marketId,
      scope: "global",
      type: "top_burner",
      question: "Does this market serialize its trades?",
      b: B,
      closesAt: new Date(Date.now() + 3_600_000),
      resolvesAt: new Date(Date.now() + 7_200_000),
      createdBy: builderId,
    });
    await db.insert(outcomes).values(
      outcomeIds.map((id, sort) => ({ id, marketId, label: `outcome ${sort}`, sort })),
    );
  });

  afterAll(async () => {
    if (!hasDatabase) return;
    await db.delete(markets).where(eq(markets.id, marketId));
    await db.delete(builders).where(eq(builders.id, builderId));
  });

  it("serializes two concurrent trades and prices the second against the first", async () => {
    const buy = (shares: number) =>
      executeTrade(builderId, marketId, {
        outcomeId: outcomeIds[0],
        side: "buy",
        shares,
        // No preview, so neither trade is refused for slippage: the point is the lock.
        previewAveragePrice: 0,
        acceptSlippage: true,
      });

    const [first, second] = await Promise.all([buy(30), buy(20)]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const [outcome] = await db
      .select({ shares: outcomes.sharesOutstanding })
      .from(outcomes)
      .where(eq(outcomes.id, outcomeIds[0]));
    expect(outcome.shares).toBe(50);

    /*
      Whichever ran second must have started from the other's book. Priced
      against an empty book both would have paid the opening price, and the two
      costs would add up to less than they do here.
    */
    const paid = first.plan.quote.credits + second.plan.quote.credits;
    const sequential =
      lmsrQuote([0, 0], B, 0, "buy", 30).credits +
      lmsrQuote([30, 0], B, 0, "buy", 20).credits;
    const parallel = 2 * lmsrQuote([0, 0], B, 0, "buy", 25).credits;
    expect(paid).toBeCloseTo(sequential, 3);
    expect(paid).toBeGreaterThan(parallel);

    // One ledger row per trade, and the cached balance equals their sum.
    const [{ balance, rows }] = await db
      .select({
        balance: sql<number>`sum(${creditLedger.delta})::float8`,
        rows: sql<number>`count(*)::int`,
      })
      .from(creditLedger)
      .where(eq(creditLedger.builderId, builderId));
    expect(rows).toBe(3);
    expect(balance).toBeCloseTo(STARTING_CREDITS - paid, 4);

    const [cached] = await db
      .select({ creditBalance: builders.creditBalance })
      .from(builders)
      .where(eq(builders.id, builderId));
    expect(cached.creditBalance).toBeCloseTo(balance, 4);

    const [position] = await db
      .select({ shares: positions.shares, costBasis: positions.costBasis })
      .from(positions)
      .where(eq(positions.builderId, builderId));
    expect(position.shares).toBe(50);
    expect(position.costBasis).toBeCloseTo(paid, 3);

    const tape = await db.select().from(trades).where(eq(trades.marketId, marketId));
    expect(tape).toHaveLength(2);
    /*
      A remote database, two trades that must take the same row lock in turn,
      and the rest of the suite talking to it at the same time. Five seconds is
      the default, not a budget this can hold: raised here rather than globally
      so a genuine hang anywhere else still fails fast.
    */
  }, 30_000);

  it("refuses the trade that would take the balance negative", async () => {
    const [balanceRow] = await db
      .select({ balance: sql<number>`sum(${creditLedger.delta})::float8` })
      .from(creditLedger)
      .where(eq(creditLedger.builderId, builderId));

    /*
      A share never costs more than 1 credit and this many cost close to it, so
      one of these fits inside the balance and two cannot. Whichever loses the
      race has to be refused rather than overdrawn.
    */
    const huge = () =>
      executeTrade(builderId, marketId, {
        outcomeId: outcomeIds[1],
        side: "buy",
        shares: Math.round(balanceRow.balance * 0.7),
        previewAveragePrice: 0,
        acceptSlippage: true,
      });

    const results = await Promise.all([huge(), huge()]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toMatchObject([
      { code: "insufficient_balance" },
    ]);

    const [after] = await db
      .select({ balance: sql<number>`sum(${creditLedger.delta})::float8` })
      .from(creditLedger)
      .where(eq(creditLedger.builderId, builderId));
    expect(after.balance).toBeGreaterThanOrEqual(0);
    expect(after.balance).toBeLessThan(balanceRow.balance);
  });

  it("quotes a budget in shares, and writes nothing", async () => {
    const { quoteTrade } = await import("./trade-store");
    const before = await db.select().from(trades).where(eq(trades.marketId, marketId));

    const budget = 5;
    const quote = await quoteTrade(builderId, marketId, {
      outcomeId: outcomeIds[0],
      side: "buy",
      credits: budget,
    });

    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    // The whole point of a budget: it is a ceiling, and it is nearly met.
    expect(quote.plan.quote.credits).toBeLessThanOrEqual(budget);
    expect(quote.plan.quote.credits).toBeGreaterThan(budget * 0.99);
    expect(quote.shares).toBeGreaterThan(0);
    expect(quote.balanceAfter).toBeCloseTo(quote.balance - quote.plan.quote.credits, 4);

    const after = await db.select().from(trades).where(eq(trades.marketId, marketId));
    expect(after).toHaveLength(before.length);
  });

  it("refuses to quote a sell of shares nobody holds", async () => {
    const { quoteTrade } = await import("./trade-store");
    const quote = await quoteTrade(builderId, marketId, {
      outcomeId: outcomeIds[0],
      side: "sell",
      shares: 1_000_000,
    });
    expect(quote.ok).toBe(false);
    if (quote.ok) return;
    expect(quote.code).toBe("insufficient_shares");
  });
  it("lets only members trade a community market", async () => {
    const { communities, memberships } = await import("@/db/schema");
    const { quoteTrade } = await import("./trade-store");
    const ownerId = crypto.randomUUID();
    const communityId = crypto.randomUUID();
    const communityMarketId = crypto.randomUUID();
    const outcomeId = crypto.randomUUID();
    const tag = communityMarketId.slice(0, 8);
    // The owner cascades to the Community and its Market, so one delete cleans up.
    await db.insert(builders).values({ id: ownerId, githubId: `test:${ownerId}`, handle: `trade-owner-${tag}` });
    try {
      await db.insert(communities).values({
        id: communityId,
        slug: `trade-test-${tag}`,
        name: "Trade test",
        ownerId,
        inviteCode: `trade-test-${tag}`,
      });
      await db.insert(markets).values({
        id: communityMarketId,
        scope: "community",
        communityId,
        type: "top_burner",
        question: "Who trades a members-only market?",
        b: B,
        closesAt: new Date(Date.now() + 3_600_000),
        resolvesAt: new Date(Date.now() + 7_200_000),
        createdBy: ownerId,
      });
      await db.insert(outcomes).values([
        { id: outcomeId, marketId: communityMarketId, label: "yes", sort: 0 },
        { marketId: communityMarketId, label: "no", sort: 1 },
      ]);

      const request = {
        outcomeId,
        side: "buy" as const,
        shares: 1,
        previewAveragePrice: 0,
        acceptSlippage: true,
      };
      const outsider = await executeTrade(builderId, communityMarketId, request);
      expect(outsider).toMatchObject({ ok: false, code: "not_a_member" });
      const outsiderQuote = await quoteTrade(builderId, communityMarketId, {
        outcomeId,
        side: "buy",
        credits: 5,
      });
      expect(outsiderQuote).toMatchObject({ ok: false, code: "not_a_member" });

      await db.insert(memberships).values({ communityId, builderId, role: "member" });
      const member = await executeTrade(builderId, communityMarketId, request);
      expect(member.ok).toBe(true);

      // Removed from the Community, they can no longer buy but can still get out.
      await db.delete(memberships).where(eq(memberships.builderId, builderId));
      const sell = await executeTrade(builderId, communityMarketId, { ...request, side: "sell" });
      expect(sell.ok).toBe(true);
    } finally {
      await db.delete(builders).where(eq(builders.id, ownerId));
    }
  });
});
