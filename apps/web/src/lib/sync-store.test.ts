/*
  The Sync store against a real Postgres. sync.test.ts proves the rules against
  maps; this proves the SQL under them: the batched foreign-receipt lookup keeps
  each row's receipts under its own model, and the stored figures and bytea
  fingerprints read back in the shape the rules compare. Runs against
  DATABASE_URL when there is one and skips itself when there is not.
*/
import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { SyncDay, SyncPayload } from "@tokenburnmarket/core";
import { db } from "@/db";
import { builderDays, builders, devices, usageDays } from "@/db/schema";
import { applySync } from "./sync";
import { drizzleSyncStore } from "./sync-store";

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

/* A handle no GitHub login can have and days before the product existed. */
const PREFIX = "tbm.sync.test.";
const DAY = "2019-04-16";
const OLD = "2019-04-01";
const NOW = new Date(`${DAY}T12:00:00.000Z`);

function stream(count: number, salt = "a"): string[] {
  return Array.from({ length: count }, (_, i) => `${salt}${String(i).padStart(63, "0")}`);
}

function day(overrides: Partial<SyncDay> = {}): SyncDay {
  return {
    day: DAY,
    provider: "claude",
    model: "claude-opus-5",
    inputTokens: 5000,
    cachedInputTokens: 200_000,
    cacheWriteTokens: 20_000,
    outputTokens: 1000,
    reasoningTokens: 0,
    costUsd: 5.123456,
    receipts: stream(10),
    ...overrides,
  };
}

function payload(deviceId: string, days: SyncDay[], reviewHistory = false): SyncPayload {
  return {
    version: 1,
    deviceId,
    sentAt: NOW.toISOString(),
    days,
    ...(reviewHistory ? { reviewHistory: true as const } : {}),
  };
}

async function cleanup() {
  // devices, receipts, usage_days and builder_days all cascade from builders.
  await db.delete(builders).where(sql`${builders.handle} like ${`${PREFIX}%`}`);
}

async function seed() {
  const [builder] = await db
    .insert(builders)
    .values({ githubId: `${PREFIX}a`, handle: `${PREFIX}a` })
    .returning({ id: builders.id });
  const ids = await db
    .insert(devices)
    .values(["a", "b", "c"].map((name) => ({ builderId: builder!.id, name, publicKey: `${PREFIX}${name}` })))
    .returning({ id: devices.id });
  const device = (index: number, watermarkDay: string | null = null) => ({
    id: ids[index]!.id,
    builderId: builder!.id,
    watermarkDay,
  });
  return { builderId: builder!.id, device };
}

async function usageRow(deviceId: string, rowDay: string, model = "claude-opus-5") {
  const [row] = await db
    .select()
    .from(usageDays)
    .where(and(eq(usageDays.deviceId, deviceId), eq(usageDays.day, rowDay), eq(usageDays.model, model)));
  return row;
}

async function rolledCost(builderId: string, rowDay: string) {
  const [row] = await db
    .select()
    .from(builderDays)
    .where(and(eq(builderDays.builderId, builderId), eq(builderDays.day, rowDay)));
  return row?.costUsd;
}

describe.skipIf(!connected)("the Drizzle Sync store", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  it("finds each recent row's foreign receipts in one batch, per model", async () => {
    const { builderId, device } = await seed();
    const days = [day(), day({ model: "claude-fable-5-1", receipts: stream(10, "b") })];
    await applySync(drizzleSyncStore, device(0), payload(device(0).id, days), NOW);

    const found = await drizzleSyncStore.foreignReceipts(builderId, device(1).id, [
      ...days,
      // Device A's opus receipts sent under a model A never reported: no owner.
      day({ model: "other" }),
    ]);
    expect(found).toHaveLength(20);
    expect(new Set(found.map((row) => `${row.model}|${row.hash[0]}`))).toEqual(
      new Set(["claude-opus-5|a", "claude-fable-5-1|b"]),
    );

    const second = await applySync(drizzleSyncStore, device(1), payload(device(1).id, days), NOW);
    expect(second.days.map((row) => row.reasons.map((reason) => reason.code))).toEqual([
      ["duplicate_of_device"], ["duplicate_of_device"],
    ]);
    expect(await rolledCost(builderId, DAY)).toBeCloseTo(10.246912, 6);
  });

  it("dedupes an exact copy of an old row stored before fingerprints", async () => {
    const { builderId, device } = await seed();
    await applySync(drizzleSyncStore, device(0), payload(device(0).id, [day({ day: OLD })]), NOW);
    expect((await usageRow(device(0).id, OLD))?.receiptFingerprint).toMatch(/^[a-f0-9]{64}$/);
    await db
      .update(usageDays)
      .set({ receiptFingerprint: null })
      .where(eq(usageDays.deviceId, device(0).id));

    await applySync(drizzleSyncStore, device(1), payload(device(1).id, [
      day({ day: OLD, receipts: stream(10, "c") }),
    ]), NOW);
    await applySync(drizzleSyncStore, device(2), payload(device(2).id, [
      day({ day: OLD, receipts: stream(10, "c"), outputTokens: 1001 }),
    ]), NOW);
    expect((await usageRow(device(1).id, OLD))?.duplicateOfDeviceId).toBe(device(0).id);
    expect((await usageRow(device(2).id, OLD))?.duplicateOfDeviceId).toBeNull();
    expect(await rolledCost(builderId, OLD)).toBeCloseTo(10.246912, 6);
  });

  it("keeps unchanged old rows during a history review and reviews changed ones", async () => {
    const { device } = await seed();
    const old2 = "2019-04-02";
    await applySync(drizzleSyncStore, device(0), payload(device(0).id, [
      day({ day: OLD }), day({ day: old2 }), day(),
    ]), NOW);
    const review = await applySync(drizzleSyncStore, device(0, DAY), payload(device(0).id, [
      day({ day: OLD, receipts: [...stream(10)].reverse() }),
      day({ day: old2, costUsd: 6 }),
      day(),
    ], true), NOW);
    expect(review.days.map((row) => row.trustLevel)).toEqual(["verified", "quarantined", "verified"]);
    expect((await usageRow(device(0).id, OLD))?.trustLevel).toBe("verified");
    expect((await usageRow(device(0).id, old2))).toMatchObject({ trustLevel: "quarantined", costUsd: 6 });
  });
});
