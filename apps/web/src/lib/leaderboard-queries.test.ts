/*
  Cross-check: the ranking the pure function produces has to match what SQL says
  about the same fixtures. It needs a real Postgres, so it runs against
  DATABASE_URL when there is one and skips itself when there is not, which keeps
  `pnpm test` honest on a machine with no database.
*/
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { builderDays, builders, creditLedger } from "@/db/schema";
import { rankEntries } from "./leaderboard";
import { boardEntries } from "./leaderboard-queries";

/** .env.local is where a developer keeps the dev database; vitest does not read it. */
function databaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const text = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
    const match = /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(text);
    if (match) process.env.DATABASE_URL = match[1];
  } catch {
    // No env file, no database, nothing to cross-check.
  }
  return process.env.DATABASE_URL;
}

const connected = Boolean(databaseUrl());

/*
  Fixtures live under a country code no real Builder picks and a handle prefix
  no GitHub login can have, so the test is isolated from whatever else the dev
  database holds and from another test running beside it.
*/
const FIXTURE_COUNTRY = "AQ";
const PREFIX = "tbm.board.test.";
const WEEK = { start: "2019-03-04", end: "2019-03-10" };

const FIXTURES = [
  { handle: "one", days: [{ day: "2019-03-04", cost: 120.5, tokens: 900, trust: "verified" }] },
  {
    handle: "two",
    days: [
      { day: "2019-03-05", cost: 300.25, tokens: 100, trust: "verified" },
      { day: "2019-03-06", cost: 40, tokens: 50, trust: "reported" },
    ],
  },
  {
    handle: "three",
    days: [
      { day: "2019-03-07", cost: 90, tokens: 4000, trust: "verified" },
      // Quarantined days never count, in any metric.
      { day: "2019-03-08", cost: 9000, tokens: 9_000_000, trust: "quarantined" },
    ],
  },
  // Burned only outside the week, so the board must leave them out.
  { handle: "four", days: [{ day: "2019-03-11", cost: 500, tokens: 10, trust: "verified" }] },
] as const;

async function seed() {
  const rows = await db
    .insert(builders)
    .values(
      FIXTURES.map((fixture) => ({
        githubId: `${PREFIX}${fixture.handle}`,
        handle: `${PREFIX}${fixture.handle}`,
        country: FIXTURE_COUNTRY,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: builders.id, handle: builders.handle });

  const byHandle = new Map(rows.map((row) => [row.handle, row.id]));
  await db
    .insert(builderDays)
    .values(
      FIXTURES.flatMap((fixture) =>
        fixture.days.map((day) => ({
          builderId: byHandle.get(`${PREFIX}${fixture.handle}`)!,
          day: day.day,
          costUsd: day.cost,
          totalTokens: day.tokens,
          trustLevelMin: day.trust,
        })),
      ),
    )
    .onConflictDoNothing();

  return byHandle;
}

async function cleanup() {
  // builder_days cascades from builders, so one delete takes the whole fixture.
  await db.delete(builders).where(sql`${builders.handle} like ${`${PREFIX}%`}`);
}

/** The same board, expressed only in SQL. Nothing here reuses the query layer. */
async function sqlRanking(metric: "cost" | "tokens") {
  const value = metric === "cost" ? sql`sum(d.cost_usd)` : sql`sum(d.total_tokens)`;
  const result = await db.execute(sql`
    select b.handle as handle,
           rank() over (order by ${value} desc) as rank,
           ${value}::double precision as value
    from builders b
    join builder_days d on d.builder_id = b.id
    where b.country = ${FIXTURE_COUNTRY}
      and b.handle like ${`${PREFIX}%`}
      and d.trust_level_min <> 'quarantined'
      and d.day between ${WEEK.start} and ${WEEK.end}
    group by b.id, b.handle
    order by rank, b.handle
  `);
  const rows = (Array.isArray(result) ? result : result.rows) as {
    handle: string;
    rank: number | string;
    value: number | string;
  }[];
  return rows.map((row) => ({
    handle: row.handle,
    rank: Number(row.rank),
    value: Number(row.value),
  }));
}

describe.skipIf(!connected)("leaderboard ranking against SQL", () => {
  afterAll(cleanup);

  it.each(["cost", "tokens"] as const)("matches a SQL cross-check on %s", async (metric) => {
    await cleanup();
    await seed();

    const entries = await boardEntries(
      { kind: "countries", countries: [FIXTURE_COUNTRY] },
      WEEK,
      metric,
      100,
    );
    const ours = rankEntries(entries, metric).map((row) => ({
      handle: row.handle,
      rank: row.rank,
      value: row.value,
    }));

    const theirs = await sqlRanking(metric);
    expect(theirs).not.toHaveLength(0);
    expect(ours).toEqual(theirs);
  });

  it("badges a Builder Reported when any counted day in the period was", async () => {
    await cleanup();
    await seed();

    const entries = await boardEntries(
      { kind: "countries", countries: [FIXTURE_COUNTRY] },
      WEEK,
      "cost",
      100,
    );
    const byHandle = new Map(entries.map((entry) => [entry.handle, entry]));
    expect(byHandle.get(`${PREFIX}two`)?.reported).toBe(true);
    expect(byHandle.get(`${PREFIX}one`)?.reported).toBe(false);
    // The only day outside the week belongs to `four`, so they are off the board.
    expect(byHandle.has(`${PREFIX}four`)).toBe(false);
    // Credits won is zero everywhere until Markets exist.
    expect(entries.every((entry) => entry.creditsWon === 0)).toBe(true);
  });

  it("counts payouts and sales less what buying cost, and nothing else", async () => {
    await cleanup();
    const ids = await seed();

    const one = ids.get(`${PREFIX}one`)!;
    const inWeek = new Date("2019-03-06T12:00:00.000Z");
    await db.insert(creditLedger).values([
      { builderId: one, delta: 100, reason: "payout", refId: "t1", createdAt: inWeek },
      { builderId: one, delta: 30, reason: "sell", refId: "t2", createdAt: inWeek },
      { builderId: one, delta: -50, reason: "buy", refId: "t3", createdAt: inWeek },
      // Minting is a faucet, not a winning, and a refund is neither.
      { builderId: one, delta: 900, reason: "mint", refId: "t4", createdAt: inWeek },
      { builderId: one, delta: 7, reason: "refund", refId: "t5", createdAt: inWeek },
      // Outside the Season, so outside the number.
      {
        builderId: one,
        delta: 500,
        reason: "payout",
        refId: "t6",
        createdAt: new Date("2019-03-11T00:00:00.000Z"),
      },
    ]);

    const entries = await boardEntries(
      { kind: "countries", countries: [FIXTURE_COUNTRY] },
      WEEK,
      "credits",
      100,
    );
    const byHandle = new Map(entries.map((entry) => [entry.handle, entry]));
    expect(byHandle.get(`${PREFIX}one`)?.creditsWon).toBe(80);
    expect(byHandle.get(`${PREFIX}two`)?.creditsWon).toBe(0);
  });
});
