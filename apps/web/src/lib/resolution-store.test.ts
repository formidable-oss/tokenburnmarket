/*
  The one resolution test that needs a real database, because what it checks is
  a database guarantee: a settled Market's ledger rows and the balances they
  produce agree, and settling the same Market twice writes nothing the second
  time.

  It runs against the dev Neon database and skips itself when DATABASE_URL is
  absent, so CI and a fresh clone stay green without one. Everything it creates
  is deleted afterwards, and it only ever touches its own Market: the run loop
  is not called here because closing Markets is a site-wide statement.
*/
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// vitest does not read .env.local, and drizzle's config is not loaded here.
try {
  process.loadEnvFile?.(".env.local");
} catch {
  // No env file is the same as no DATABASE_URL: the suite skips.
}

const hasDatabase = Boolean(process.env.DATABASE_URL);
const PERIOD = { start: "2026-01-05", end: "2026-01-11" };
const STARTING_CREDITS = 1000;

describe.skipIf(!hasDatabase)("settling a market against the dev database", async () => {
  const { db } = await import("@/db");
  const { builderDays, builders, creditLedger, markets, outcomes, positions } = await import(
    "@/db/schema"
  );
  const { marketRef, planResolution } = await import("./resolution");
  const { drizzleResolutionStore } = await import("./resolution-store");

  const marketId = crypto.randomUUID();
  const suffix = marketId.slice(0, 8);
  const ada = crypto.randomUUID();
  const ben = crypto.randomUUID();
  const yes = crypto.randomUUID();
  const no = crypto.randomUUID();
  const now = new Date("2026-01-13T00:00:00Z");

  beforeAll(async () => {
    await db.insert(builders).values([
      { id: ada, githubId: `test:${ada}`, handle: `resolve-ada-${suffix}` },
      { id: ben, githubId: `test:${ben}`, handle: `resolve-ben-${suffix}` },
    ]);
    await db.insert(creditLedger).values(
      [ada, ben].map((builderId) => ({
        builderId,
        delta: STARTING_CREDITS,
        reason: "signup" as const,
        refId: `test:${builderId}`,
      })),
    );

    // Ada burns 60 dollars over the period, which is over the 50 the market asks about.
    await db.insert(builderDays).values([
      { builderId: ada, day: PERIOD.start, costUsd: 25, totalTokens: 1_000, trustLevelMin: "verified" },
      { builderId: ada, day: PERIOD.end, costUsd: 35, totalTokens: 2_000, trustLevelMin: "reported" },
    ]);

    await db.insert(markets).values({
      id: marketId,
      scope: "global",
      type: "threshold",
      question: `Does ada burn $50 or more, ${PERIOD.start} to ${PERIOD.end}?`,
      params: {
        template: "threshold",
        scope: { kind: "global" },
        period: PERIOD,
        threshold: { builderId: ada, handle: `resolve-ada-${suffix}`, costUsd: 50 },
      },
      b: 50,
      closesAt: new Date("2026-01-12T00:00:00Z"),
      resolvesAt: new Date("2026-01-13T00:00:00Z"),
      status: "closed",
      createdBy: ada,
    });
    await db.insert(outcomes).values([
      { id: yes, marketId, label: "$50 or more", ref: { kind: "threshold_met" }, sort: 0 },
      { id: no, marketId, label: "under $50", ref: { kind: "threshold_missed" }, sort: 1 },
    ]);
    await db.insert(positions).values([
      { marketId, outcomeId: yes, builderId: ada, shares: 10, costBasis: 4 },
      { marketId, outcomeId: yes, builderId: ben, shares: 5, costBasis: 3.25 },
      { marketId, outcomeId: no, builderId: ben, shares: 2, costBasis: 1 },
    ]);
  });

  afterAll(async () => {
    if (!hasDatabase) return;
    await db.delete(markets).where(eq(markets.id, marketId));
    await db.delete(builderDays).where(inArray(builderDays.builderId, [ada, ben]));
    await db.delete(builders).where(inArray(builders.id, [ada, ben]));
  });

  it("resolves from usage, pays winners once, and reconciles balances", async () => {
    const due = await drizzleResolutionStore.dueForResolution(now);
    const market = due.find((row) => row.id === marketId);
    expect(market).toBeDefined();
    if (!market) return;

    const snapshot = await drizzleResolutionStore.snapshotFor(market);
    expect(snapshot.builders).toEqual([
      {
        builderId: ada,
        handle: `resolve-ada-${suffix}`,
        costUsd: 60,
        totalTokens: 3_000,
        quarantined: false,
      },
    ]);

    const action = planResolution(market, snapshot, now);
    expect(action).toEqual({ kind: "resolve", winningOutcomeId: yes });
    if (action.kind !== "resolve") return;

    const paid = await drizzleResolutionStore.payout(marketId, action.winningOutcomeId, now);
    expect(paid).toEqual({ builders: 2, credits: 15 });

    // The second call is the overlapping cron run: it finds the market settled.
    expect(await drizzleResolutionStore.payout(marketId, action.winningOutcomeId, now)).toEqual({
      builders: 0,
      credits: 0,
    });

    const [settled] = await db
      .select({ status: markets.status, winningOutcomeId: markets.winningOutcomeId })
      .from(markets)
      .where(eq(markets.id, marketId));
    expect(settled).toEqual({ status: "resolved", winningOutcomeId: yes });

    const payouts = await db
      .select({ builderId: creditLedger.builderId, delta: creditLedger.delta })
      .from(creditLedger)
      .where(eq(creditLedger.refId, marketRef(marketId)));
    expect(payouts).toHaveLength(2);
    expect(new Map(payouts.map((row) => [row.builderId, row.delta]))).toEqual(
      new Map([
        [ada, 10],
        [ben, 5],
      ]),
    );

    // The balance is a cache of the ledger, and after settling it still says so.
    const reconciled = await db
      .select({
        id: builders.id,
        balance: builders.creditBalance,
        ledger: sql<number>`(
          select coalesce(sum(ledger.delta), 0) from credit_ledger ledger
          where ledger.builder_id = builders.id
        )::double precision`,
      })
      .from(builders)
      .where(inArray(builders.id, [ada, ben]));

    for (const row of reconciled) {
      expect(Number(row.balance)).toBe(Number(row.ledger));
    }
    expect(reconciled.map((row) => Number(row.balance)).sort()).toEqual([
      STARTING_CREDITS + 5,
      STARTING_CREDITS + 10,
    ]);
  });
});
