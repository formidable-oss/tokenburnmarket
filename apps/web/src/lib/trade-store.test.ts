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
  });

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
});
