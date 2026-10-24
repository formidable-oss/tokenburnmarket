/*
  The Sync store against a real Postgres. sync.test.ts proves the rules against
  maps; this proves the SQL under them: the batched foreign-receipt lookup keeps
  each row's receipts under its own model, the stored figures and bytea
  fingerprints read back in the shape the rules compare, an Admin's latest
  decision is read per row, and machine verdicts land on the rows they name.
  Runs against DATABASE_URL when there is one and skips itself when there is not.
*/
import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { SyncDay, SyncPayload } from "@tokenburnmarket/core";
import { db } from "@/db";
import { builderDays, builders, devices, quarantineReviews, usageDays } from "@/db/schema";
import { devicesWithUsage } from "./device-queries";
import { applySync, regroupMachines, restoreRetiredQuarantines } from "./sync";
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

function payload(deviceId: string, days: SyncDay[]): SyncPayload {
  return { version: 1, deviceId, sentAt: NOW.toISOString(), days };
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
    .returning({ id: devices.id, machineId: devices.machineId });
  const device = (index: number, watermarkDay: string | null = null) => ({
    id: ids[index]!.id,
    builderId: builder!.id,
    watermarkDay,
  });
  return { builderId: builder!.id, device, machineOf: (index: number) => ids[index]!.machineId };
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

  it("raises and corrects old rows, and never lowers them", async () => {
    const { builderId, device } = await seed();
    const old2 = "2019-04-02";
    await applySync(drizzleSyncStore, device(0), payload(device(0).id, [
      day({ day: OLD }), day({ day: old2 }), day(),
    ]), NOW);
    const again = await applySync(drizzleSyncStore, device(0, DAY), payload(device(0).id, [
      day({ day: OLD, costUsd: 6 }),
      day({ day: old2, receipts: stream(4), outputTokens: 10, costUsd: 1 }),
      day(),
    ]), NOW);
    expect(again.days.map((row) => row.trustLevel)).toEqual(["verified", "verified", "verified"]);
    expect(await usageRow(device(0).id, OLD)).toMatchObject({ trustLevel: "verified", costUsd: 6 });
    expect(await usageRow(device(0).id, old2)).toMatchObject({ costUsd: 5.123456, receiptCount: 10 });
    expect(await rolledCost(builderId, OLD)).toBe(6);
  });

  it("leaves a row an Admin kept out, and only while that is the row's latest decision", async () => {
    const { builderId, device } = await seed();
    const old2 = "2019-04-02";
    await applySync(drizzleSyncStore, device(0), payload(device(0).id, [day({ day: OLD }), day({ day: old2 })]), NOW);
    await db.update(usageDays).set({ trustLevel: "quarantined" }).where(eq(usageDays.deviceId, device(0).id));
    const review = { deviceId: device(0).id, day: OLD, provider: "claude", model: "claude-opus-5", reviewerId: builderId };
    await db.insert(quarantineReviews).values({ ...review, decision: "reported", createdAt: new Date("2019-04-16T08:00:00Z") });
    await db.insert(quarantineReviews).values({ ...review, decision: "keep", createdAt: new Date("2019-04-16T09:00:00Z") });
    // A later decision on another row must not stand in for this one's.
    await db.insert(quarantineReviews).values({ ...review, day: old2, decision: "verified", createdAt: new Date("2019-04-16T09:30:00Z") });

    const stored = await drizzleSyncStore.storedUsage(device(0).id, [OLD, old2]);
    expect(stored.find((row) => row.day === OLD)).toMatchObject({ keptOut: true, duplicateOfDeviceId: null });
    expect(stored.find((row) => row.day === old2)).toMatchObject({ keptOut: false });
    expect(stored[0]!.checkedAt).toBeInstanceOf(Date);
    expect((await drizzleSyncStore.quarantinedUsage()).filter((row) => row.builderId === builderId).map((row) => row.day))
      .toEqual([old2]);
    await applySync(drizzleSyncStore, device(0, DAY), payload(device(0).id, [day({ day: OLD, costUsd: 9 })]), NOW);
    expect(await usageRow(device(0).id, OLD)).toMatchObject({ trustLevel: "quarantined", costUsd: 5.123456 });

    await db.insert(quarantineReviews).values({ ...review, decision: "verified", createdAt: new Date("2019-04-16T10:00:00Z") });
    expect((await drizzleSyncStore.storedUsage(device(0).id, [OLD]))[0]?.keptOut).toBe(false);
  });

  it("counts one machine once across its devices, and twice once they split", async () => {
    const { builderId, device, machineOf } = await seed();
    const machine = machineOf(0);
    await db.update(devices).set({ machineId: machine }).where(eq(devices.id, device(1).id));
    expect(new Set(await drizzleSyncStore.machineMembers(builderId, machine))).toEqual(
      new Set([device(0).id, device(1).id]),
    );

    await applySync(drizzleSyncStore, device(0), payload(device(0).id, [day({ day: OLD })]), NOW);
    const later = new Date(NOW.getTime() + 3_600_000);
    expect(await drizzleSyncStore.machineOf(device(1).id)).toBe(machine);
    await applySync(
      drizzleSyncStore,
      device(1),
      { ...payload(device(1).id, [day({ day: OLD, receipts: stream(10, "b"), costUsd: 6 })]), sentAt: later.toISOString() },
      later,
    );
    expect(await usageRow(device(0).id, OLD)).toMatchObject({
      duplicateOfDeviceId: device(1).id,
      trustLevel: "reported",
      quarantineReasons: [expect.objectContaining({ code: "same_machine" })],
    });
    expect(await usageRow(device(1).id, OLD)).toMatchObject({ duplicateOfDeviceId: null, trustLevel: "verified" });
    expect(await rolledCost(builderId, OLD)).toBe(6);

    const own = "00000000-0000-4000-8000-000000000001";
    await db.update(devices).set({ machineId: own }).where(eq(devices.id, device(1).id));
    expect(await regroupMachines(drizzleSyncStore, builderId, [machine, own], later)).toBe(1);
    expect(await usageRow(device(0).id, OLD)).toMatchObject({
      duplicateOfDeviceId: null, trustLevel: "verified", quarantineReasons: [],
    });
    expect(await rolledCost(builderId, OLD)).toBeCloseTo(11.123456, 6);

    const summary = await devicesWithUsage(builderId);
    expect(summary.map((row) => [row.name, row.firstDay, row.lastDay, row.countedCostUsd])).toEqual([
      ["a", OLD, OLD, 5.123456],
      ["b", OLD, OLD, 6],
      ["c", null, null, 0],
    ]);
  });

  it("puts back rows that only retired checks quarantined, and keeps what an Admin kept out", async () => {
    const { builderId, device } = await seed();
    await applySync(drizzleSyncStore, device(0), payload(device(0).id, [day({ day: OLD }), day()]), NOW);
    await db
      .update(usageDays)
      .set({ trustLevel: "quarantined", quarantineReasons: [{ code: "stale_backfill", message: "old" }] })
      .where(and(eq(usageDays.deviceId, device(0).id), eq(usageDays.day, OLD)));
    await db
      .update(usageDays)
      .set({ trustLevel: "quarantined", quarantineReasons: [{ code: "stale_backfill", message: "old" }] })
      .where(and(eq(usageDays.deviceId, device(0).id), eq(usageDays.day, DAY)));
    await db.insert(quarantineReviews).values({
      deviceId: device(0).id, day: DAY, provider: "claude", model: "claude-opus-5", decision: "keep", reviewerId: builderId,
    });
    await db.update(builderDays).set({ trustLevelMin: "quarantined", costUsd: 0 }).where(eq(builderDays.builderId, builderId));

    // Scoped to this Builder, at the real time, so other rows in the database stay as they are.
    expect(await restoreRetiredQuarantines(drizzleSyncStore, new Date(), builderId)).toBe(1);
    expect(await usageRow(device(0).id, OLD)).toMatchObject({ trustLevel: "verified", quarantineReasons: [] });
    expect(await usageRow(device(0).id, DAY)).toMatchObject({ trustLevel: "quarantined" });
    expect(await rolledCost(builderId, OLD)).toBe(5.123456);
  });

  it("never writes over a row an Admin kept out, nor lets it back in", async () => {
    const { builderId, device } = await seed();
    await applySync(drizzleSyncStore, device(0), payload(device(0).id, [day({ day: OLD })]), NOW);
    const key = and(eq(usageDays.deviceId, device(0).id), eq(usageDays.day, OLD));
    await db.update(usageDays).set({ trustLevel: "quarantined" }).where(key);
    await db.insert(quarantineReviews).values({
      deviceId: device(0).id, day: OLD, provider: "claude", model: "claude-opus-5", decision: "keep", reviewerId: builderId,
    });

    await drizzleSyncStore.putUsageRows([{
      deviceId: device(0).id, builderId, day: OLD, provider: "claude", model: "claude-opus-5",
      inputTokens: 1, cachedInputTokens: 1, cacheWriteTokens: 1, outputTokens: 1, reasoningTokens: 0, costUsd: 99,
      trustLevel: "verified", quarantineReasons: [], receiptCount: 1, receiptFingerprint: null,
      duplicateOfDeviceId: null, checkedAt: NOW,
    }]);
    await drizzleSyncStore.putVerdicts([{
      deviceId: device(0).id, day: OLD, provider: "claude", model: "claude-opus-5",
      trustLevel: "verified", quarantineReasons: [], duplicateOfDeviceId: null,
    }]);
    expect(await usageRow(device(0).id, OLD)).toMatchObject({ trustLevel: "quarantined", costUsd: 5.123456 });

    // Staying out is still allowed: a kept-out row can become another row's copy.
    await drizzleSyncStore.putVerdicts([{
      deviceId: device(0).id, day: OLD, provider: "claude", model: "claude-opus-5",
      trustLevel: "quarantined", quarantineReasons: [{ code: "same_machine", message: "copy" }], duplicateOfDeviceId: device(1).id,
    }]);
    expect((await usageRow(device(0).id, OLD))?.duplicateOfDeviceId).toBe(device(1).id);
  });

  it("finds Builder-days whose totals do not match their counted rows", async () => {
    const { builderId, device } = await seed();
    const old2 = "2019-04-02";
    await applySync(drizzleSyncStore, device(0), payload(device(0).id, [day({ day: OLD }), day({ day: old2 }), day()]), NOW);
    await db.update(builderDays).set({ costUsd: 1 }).where(and(eq(builderDays.builderId, builderId), eq(builderDays.day, OLD)));
    await db.delete(builderDays).where(and(eq(builderDays.builderId, builderId), eq(builderDays.day, old2)));

    const stale = (await drizzleSyncStore.staleBuilderDays()).filter((row) => row.builderId === builderId);
    expect(stale.map((row) => row.day).sort()).toEqual([OLD, old2]);
  });

  it("names Builders whose quarantined day no counted row holds back, and not one an Admin kept out", async () => {
    const { builderId, device } = await seed();
    await applySync(drizzleSyncStore, device(0), payload(device(0).id, [day({ day: OLD })]), NOW);
    await db.update(builderDays).set({ trustLevelMin: "quarantined" }).where(eq(builderDays.builderId, builderId));
    expect(await drizzleSyncStore.buildersWithStaleQuarantinedDays(builderId)).toEqual([builderId]);

    await db
      .update(usageDays)
      .set({ trustLevel: "quarantined" })
      .where(and(eq(usageDays.deviceId, device(0).id), eq(usageDays.day, OLD)));
    expect(await drizzleSyncStore.buildersWithStaleQuarantinedDays(builderId)).toEqual([]);
  });
});
