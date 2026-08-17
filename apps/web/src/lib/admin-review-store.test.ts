/*
  The review against a real Postgres. The store test above it proves the order
  of the calls; this proves the SQL under them: a Quarantined row leaves the
  queue, the Builder-day is recounted from the Usage rows, and the mint pays the
  day it is now worth. Runs against DATABASE_URL when there is one and skips
  itself when there is not, like the other database tests here.
*/
import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { builderDays, builders, creditLedger, devices, quarantineReviews, usageDays } from "@/db/schema";
import { applyReview } from "./admin-review";
import { drizzleAdminReviewStore } from "./admin-review-store";
import { quarantineQueue } from "./admin-queries";

/** .env.local is where a developer keeps the dev database; vitest does not read it. */
function databaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const text = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
    const match = /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(text);
    if (match) process.env.DATABASE_URL = match[1];
  } catch {
    // No env file, no database, nothing to check.
  }
  return process.env.DATABASE_URL;
}

const connected = Boolean(databaseUrl());

/*
  A handle prefix no GitHub login can have, and a day years before the product
  existed, so the fixture cannot collide with whatever else the dev database
  holds or with another test running beside it.
*/
const PREFIX = "tbm.admin.test.";
const DAY = "2019-04-02";
const KEY = { day: DAY, provider: "claude", model: "opus-5" };

async function cleanup() {
  // devices, usage_days, builder_days and the ledger all cascade from builders.
  await db.delete(builders).where(sql`${builders.handle} like ${`${PREFIX}%`}`);
}

/** One Builder with one Quarantined day, and the rollup that day currently has. */
async function seed() {
  const [builder] = await db
    .insert(builders)
    .values({ githubId: `${PREFIX}a`, handle: `${PREFIX}a` })
    .returning({ id: builders.id });
  const [device] = await db
    .insert(devices)
    .values({ builderId: builder!.id, name: "laptop", publicKey: `${PREFIX}key` })
    .returning({ id: devices.id });

  await db.insert(usageDays).values({
    ...KEY,
    deviceId: device!.id,
    builderId: builder!.id,
    inputTokens: 1000,
    outputTokens: 500,
    costUsd: 30,
    trustLevel: "quarantined",
    quarantineReasons: [{ code: "impossible_rate", message: "Too many tokens for the time." }],
  });
  // The rollup a Sync would have written: a Quarantined row counts for nothing.
  await db.insert(builderDays).values({
    builderId: builder!.id,
    day: DAY,
    costUsd: 0,
    totalTokens: 0,
    trustLevelMin: "quarantined",
  });

  return { builderId: builder!.id, key: { ...KEY, deviceId: device!.id } };
}

describe.skipIf(!connected)("reviewing quarantined usage", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  it("approving recounts the day, mints it, and empties the queue", async () => {
    const { builderId, key } = await seed();

    const queued = (await quarantineQueue()).find((group) => group.handle === `${PREFIX}a`);
    expect(queued?.rows).toHaveLength(1);
    expect(queued?.costUsd).toBe(30);
    expect(queued?.rows[0]?.lastDecision).toBeNull();

    const result = await applyReview(drizzleAdminReviewStore, {
      key,
      decision: "verified",
      note: "checked the receipts by hand",
      reviewerId: builderId,
    });
    expect(result.applied).toBe(true);
    expect(result.credits).toBeGreaterThan(0);

    const [rolled] = await db
      .select()
      .from(builderDays)
      .where(and(eq(builderDays.builderId, builderId), eq(builderDays.day, DAY)));
    expect(rolled).toMatchObject({ costUsd: 30, totalTokens: 1500, trustLevelMin: "verified" });
    expect(rolled!.creditsMinted).toBeCloseTo(result.credits, 4);

    const ledger = await db
      .select()
      .from(creditLedger)
      .where(and(eq(creditLedger.builderId, builderId), eq(creditLedger.reason, "mint")));
    expect(ledger).toHaveLength(1);

    const [after] = await db.select().from(builders).where(eq(builders.id, builderId));
    expect(after!.creditBalance).toBeCloseTo(result.credits, 4);

    expect((await quarantineQueue()).find((group) => group.handle === `${PREFIX}a`)).toBeUndefined();

    // A second click, or a stale page: nothing moves and nothing mints twice.
    const repeat = await applyReview(drizzleAdminReviewStore, {
      key,
      decision: "verified",
      note: null,
      reviewerId: builderId,
    });
    expect(repeat.applied).toBe(false);
    expect(
      await db
        .select()
        .from(creditLedger)
        .where(and(eq(creditLedger.builderId, builderId), eq(creditLedger.reason, "mint"))),
    ).toHaveLength(1);
  });

  it("keeping the row leaves it held, with the note attached", async () => {
    const { builderId, key } = await seed();

    const result = await applyReview(drizzleAdminReviewStore, {
      key,
      decision: "keep",
      note: "two devices, same transcripts",
      reviewerId: builderId,
    });
    expect(result).toMatchObject({ applied: true, trustLevel: "quarantined", credits: 0 });

    const still = (await quarantineQueue()).find((group) => group.handle === `${PREFIX}a`);
    expect(still?.rows[0]?.lastDecision).toBe("keep");
    expect(still?.rows[0]?.lastNote).toBe("two devices, same transcripts");

    const [rolled] = await db
      .select()
      .from(builderDays)
      .where(and(eq(builderDays.builderId, builderId), eq(builderDays.day, DAY)));
    expect(rolled).toMatchObject({ costUsd: 0, creditsMinted: 0 });

    const reviews = await db
      .select()
      .from(quarantineReviews)
      .where(eq(quarantineReviews.reviewerId, builderId));
    expect(reviews).toHaveLength(1);
  });
});
