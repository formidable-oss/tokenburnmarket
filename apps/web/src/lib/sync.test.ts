/*
  Sync behaviour against an in-memory store: the same code the route runs, with
  maps instead of Postgres. What is being pinned down is the dedupe rule, the
  re-sync rule for old days, the machine rule, the Trust Level a failed check
  produces, and how the watermark moves.
*/
import { describe, expect, it } from "vitest";
import type { SyncDay, SyncPayload } from "@tokenburnmarket/core";
import {
  applySync,
  nextWatermark,
  rollupBuilderDays,
  receiptCutoffDay,
  receiptFingerprint,
  reconcileBuilderDays,
  regroupMachines,
  restoreRetiredQuarantines,
  type BuilderDayWrite,
  type ForeignReceipt,
  type ReceiptWrite,
  type ReconcileStore,
  type RestoreStore,
  type RollupSourceRow,
  type SyncStore,
  type UsageRowWrite,
} from "./sync";

const BUILDER = "11111111-1111-4111-8111-111111111111";
const DEVICE_A = "22222222-2222-4222-8222-222222222222";
const DEVICE_B = "33333333-3333-4333-8333-333333333333";
const DEVICE_C = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-08-17T12:00:00.000Z");
const DAY = "2026-08-16";

/** Deterministic 64-hex receipt hashes, so two Devices can report the same stream. */
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
    costUsd: 5,
    receipts: stream(10),
    ...overrides,
  };
}

function payload(deviceId: string, days: SyncDay[]): SyncPayload {
  return { version: 1, deviceId, sentAt: NOW.toISOString(), days };
}

interface Memory extends SyncStore, RestoreStore, ReconcileStore {
  receipts: Map<string, ReceiptWrite>;
  usage: Map<string, UsageRowWrite>;
  builderDays: Map<string, BuilderDayWrite>;
  watermarks: Map<string, string | null>;
  /** Device id to machine id. A Device that is not here is a machine of its own. */
  machines: Map<string, string>;
  /** Usage keys whose latest Admin decision was to keep them out. */
  keptOut: Set<string>;
  /** How many rows each `foreignReceipts` call asked about. */
  foreignReceiptCalls: number[];
}

const ALL_DEVICES = [DEVICE_A, DEVICE_B, DEVICE_C];

function memoryStore(): Memory {
  const receipts = new Map<string, ReceiptWrite>();
  const usage = new Map<string, UsageRowWrite>();
  const builderDays = new Map<string, BuilderDayWrite>();
  const watermarks = new Map<string, string | null>();
  const machines = new Map<string, string>();
  const keptOut = new Set<string>();
  const foreignReceiptCalls: number[] = [];
  const key = (row: { deviceId: string; day: string; provider: string; model: string }) =>
    `${row.deviceId}|${row.day}|${row.provider}|${row.model}`;

  return {
    receipts,
    usage,
    builderDays,
    watermarks,
    machines,
    keptOut,
    foreignReceiptCalls,
    async foreignReceipts(builderId, deviceId, rows) {
      foreignReceiptCalls.push(rows.length);
      const found: ForeignReceipt[] = [];
      for (const incoming of rows) {
        for (const row of receipts.values()) {
          if (row.builderId !== builderId || row.deviceId === deviceId) continue;
          const owner = usage.get(`${row.deviceId}|${incoming.day}|${incoming.provider}|${incoming.model}`);
          if (row.day !== incoming.day || !owner || owner.duplicateOfDeviceId !== null) continue;
          if (!incoming.receipts.includes(row.hash)) continue;
          found.push({ hash: row.hash, deviceId: row.deviceId, day: incoming.day, provider: incoming.provider, model: incoming.model });
        }
      }
      return found;
    },
    async putReceipts(rows) {
      for (const row of rows) receipts.set(`${row.deviceId}|${row.hash}`, row);
    },
    async usageTwins(builderId, deviceId, days) {
      return [...usage.values()].filter(
        (row) => row.builderId === builderId && row.deviceId !== deviceId && days.includes(row.day),
      );
    },
    async storedUsage(deviceId, days) {
      return [...usage.values()]
        .filter((row) => row.deviceId === deviceId && days.includes(row.day))
        .map((row) => ({ ...row, keptOut: row.trustLevel === "quarantined" && keptOut.has(key(row)) }));
    },
    async machineOf(deviceId) {
      return machines.get(deviceId) ?? deviceId;
    },
    async quarantinedUsage(builderId) {
      return [...usage.values()]
        .filter((row) => row.trustLevel === "quarantined" && !keptOut.has(key(row)))
        .filter((row) => builderId === undefined || row.builderId === builderId)
        .map((row) => ({ ...row }));
    },
    async buildersWithStaleQuarantinedDays(builderId) {
      const heldBack = (row: BuilderDayWrite) =>
        [...usage.values()].some(
          (each) =>
            each.builderId === row.builderId &&
            each.day === row.day &&
            each.duplicateOfDeviceId === null &&
            each.trustLevel === "quarantined",
        );
      const ids = [...builderDays.values()]
        .filter((row) => row.trustLevelMin === "quarantined" && !heldBack(row))
        .map((row) => row.builderId)
        .filter((id) => builderId === undefined || id === builderId);
      return [...new Set(ids)];
    },
    async builderMachines() {
      return [...new Set(ALL_DEVICES.map((id) => machines.get(id) ?? id))];
    },
    async machineMembers(_builderId, machineId) {
      return ALL_DEVICES.filter((id) => (machines.get(id) ?? id) === machineId);
    },
    async usageOfDevices(deviceIds, days) {
      return [...usage.values()]
        .filter((row) => deviceIds.includes(row.deviceId) && (days === null || days.includes(row.day)))
        .map((row) => ({ ...row }));
    },
    async putVerdicts(rows) {
      for (const update of rows) {
        const row = usage.get(key(update));
        if (!row) throw new Error(`no row for ${key(update)}`);
        if (keptOut.has(key(update)) && update.trustLevel !== "quarantined") continue;
        row.trustLevel = update.trustLevel;
        row.quarantineReasons = update.quarantineReasons;
        row.duplicateOfDeviceId = update.duplicateOfDeviceId;
      }
    },
    async putUsageRows(rows) {
      for (const row of rows) {
        if (keptOut.has(key(row)) && usage.has(key(row))) continue;
        usage.set(key(row), { ...row });
      }
    },
    async staleBuilderDays() {
      const expected = new Map<string, BuilderDayWrite>();
      const days = new Set([...usage.values()].map((row) => `${row.builderId}|${row.day}`));
      for (const id of days) {
        const [builderId, day] = id.split("|") as [string, string];
        const rows = [...usage.values()].filter((row) => row.builderId === builderId && row.day === day);
        expected.set(id, rollupBuilderDays(builderId, [day], rows)[0]!);
      }
      const stale: { builderId: string; day: string }[] = [];
      for (const [id, want] of expected) {
        const has = builderDays.get(id);
        const counted = [...usage.values()].some((row) => `${row.builderId}|${row.day}` === id && row.duplicateOfDeviceId === null);
        if (!counted && !has) continue;
        if (!has || has.costUsd !== want.costUsd || has.totalTokens !== want.totalTokens || has.trustLevelMin !== want.trustLevelMin) {
          stale.push({ builderId: want.builderId, day: want.day });
        }
      }
      return stale;
    },
    async usageRowsForDays(builderId, days): Promise<RollupSourceRow[]> {
      return [...usage.values()]
        .filter((row) => row.builderId === builderId && days.includes(row.day))
        .map((row) => ({
          day: row.day,
          costUsd: row.costUsd,
          inputTokens: row.inputTokens,
          cachedInputTokens: row.cachedInputTokens,
          cacheWriteTokens: row.cacheWriteTokens,
          outputTokens: row.outputTokens,
          reasoningTokens: row.reasoningTokens,
          trustLevel: row.trustLevel,
          duplicateOfDeviceId: row.duplicateOfDeviceId,
        }));
    },
    async putBuilderDays(rows) {
      for (const row of rows) builderDays.set(`${row.builderId}|${row.day}`, row);
    },
    async advanceWatermark(deviceId, watermarkDay) {
      watermarks.set(deviceId, watermarkDay);
    },
  };
}

function device(id: string, watermarkDay: string | null = null) {
  return { id, builderId: BUILDER, watermarkDay };
}

describe("applySync", () => {
  it("marks a day with a Receipt Stream verified and rolls it up", async () => {
    const store = memoryStore();
    const result = await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day()]), NOW);

    expect(result.days).toEqual([
      { day: DAY, provider: "claude", model: "claude-opus-5", trustLevel: "verified", reasons: [] },
    ]);
    expect(result.nextWatermark).toBe(DAY);
    expect(store.builderDays.get(`${BUILDER}|${DAY}`)).toMatchObject({
      costUsd: 5,
      totalTokens: 226_000,
      trustLevelMin: "verified",
    });
  });

  it("does not double count two devices reading the same transcripts", async () => {
    const store = memoryStore();
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day()]), NOW);
    const second = await applySync(store, device(DEVICE_B), payload(DEVICE_B, [day()]), NOW);

    expect(second.days[0]?.trustLevel).toBe("reported");
    expect(second.days[0]?.reasons.map((reason) => reason.code)).toContain("duplicate_of_device");

    const rollup = store.builderDays.get(`${BUILDER}|${DAY}`);
    expect(rollup?.costUsd).toBe(5);
    expect(rollup?.totalTokens).toBe(226_000);

    // Both rows are kept, so the second Device still sees its own day on the profile.
    expect(store.usage.size).toBe(2);
    expect(store.usage.get(`${DEVICE_B}|${DAY}|claude|claude-opus-5`)?.duplicateOfDeviceId).toBe(
      DEVICE_A,
    );
  });

  it("keeps one counted owner through A, B, A and repeated updates", async () => {
    const store = memoryStore();
    for (const id of [DEVICE_A, DEVICE_B, DEVICE_A, DEVICE_B, DEVICE_A]) {
      await applySync(store, device(id), payload(id, [day()]), NOW);
      expect(store.builderDays.get(`${BUILDER}|${DAY}`)?.costUsd).toBe(5);
      expect([...store.usage.values()].filter((row) => row.duplicateOfDeviceId === null)).toHaveLength(1);
    }
    expect(store.usage.get(`${DEVICE_A}|${DAY}|claude|claude-opus-5`)?.duplicateOfDeviceId).toBeNull();
    expect(store.usage.get(`${DEVICE_B}|${DAY}|claude|claude-opus-5`)?.duplicateOfDeviceId).toBe(DEVICE_A);
  });

  it("counts new unique work when a duplicate device updates its day", async () => {
    const store = memoryStore();
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day()]), NOW);
    await applySync(store, device(DEVICE_B), payload(DEVICE_B, [day()]), NOW);
    await applySync(store, device(DEVICE_B, DAY), payload(DEVICE_B, [day({
      receipts: [...stream(10), ...stream(10, "b")], costUsd: 10,
    })]), NOW);
    await applySync(store, device(DEVICE_A, DAY), payload(DEVICE_A, [day({
      receipts: [...stream(10), ...stream(10, "c")], costUsd: 10,
    })]), NOW);
    expect([...store.usage.values()].map((row) => row.duplicateOfDeviceId)).toEqual([null, null]);
    expect(store.builderDays.get(`${BUILDER}|${DAY}`)?.costUsd).toBe(20);
  });

  it.each([DAY, "2026-08-01"].flatMap((rowDay) =>
    [DEVICE_A, DEVICE_B].map((first) => ({ rowDay, first })),
  ))("recovers a prior duplicate cycle for $rowDay when $first syncs", async ({ rowDay, first }) => {
    const store = memoryStore();
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day({ day: rowDay })]), NOW);
    await applySync(store, device(DEVICE_B), payload(DEVICE_B, [day({ day: rowDay })]), NOW);
    const owner = store.usage.get(`${DEVICE_A}|${rowDay}|claude|claude-opus-5`)!;
    owner.duplicateOfDeviceId = DEVICE_B;
    owner.trustLevel = "reported";
    owner.quarantineReasons = [{ code: "duplicate_of_device", message: "legacy cycle" }];
    const second = first === DEVICE_A ? DEVICE_B : DEVICE_A;
    for (const id of [first, second, first]) {
      await applySync(store, device(id, rowDay), payload(id, [day({ day: rowDay })]), NOW);
      expect(store.builderDays.get(`${BUILDER}|${rowDay}`)?.costUsd).toBe(5);
    }
    expect(store.usage.get(`${first}|${rowDay}|claude|claude-opus-5`)).toMatchObject({
      duplicateOfDeviceId: null, trustLevel: "verified", quarantineReasons: [],
    });
    expect(store.usage.get(`${second}|${rowDay}|claude|claude-opus-5`)?.duplicateOfDeviceId).toBe(first);
  });

  it("requires one counted owner to cover the overlap threshold", async () => {
    const store = memoryStore();
    const a = stream(5);
    const b = stream(5, "b");
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day({ receipts: a })]), NOW);
    await applySync(store, device(DEVICE_B), payload(DEVICE_B, [day({ receipts: b })]), NOW);
    await applySync(store, device(DEVICE_C), payload(DEVICE_C, [day({ receipts: [...a, ...b] })]), NOW);
    expect(store.builderDays.get(`${BUILDER}|${DAY}`)?.costUsd).toBe(15);
  });

  it("finds a counted owner even when another counted device shares some receipts", async () => {
    const store = memoryStore();
    const shared = stream(5);
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day()]), NOW);
    await applySync(store, device(DEVICE_B), payload(DEVICE_B, [day({
      receipts: [...shared, ...stream(5, "b")],
    })]), NOW);
    await applySync(store, device(DEVICE_C), payload(DEVICE_C, [day()]), NOW);
    expect(store.usage.get(`${DEVICE_C}|${DAY}|claude|claude-opus-5`)?.duplicateOfDeviceId).toBe(DEVICE_A);
    expect(store.builderDays.get(`${BUILDER}|${DAY}`)?.costUsd).toBe(10);
  });

  it("dedupes recent streams at the overlap threshold and counts new unique work below it", async () => {
    const store = memoryStore();
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day()]), NOW);
    await applySync(store, device(DEVICE_B), payload(DEVICE_B, [day({
      receipts: [...stream(9), ...stream(1, "b")],
    })]), NOW);
    expect(store.builderDays.get(`${BUILDER}|${DAY}`)?.costUsd).toBe(5);
    await applySync(store, device(DEVICE_B, DAY), payload(DEVICE_B, [day({
      receipts: [...stream(8), ...stream(2, "b")],
    })]), NOW);
    expect(store.builderDays.get(`${BUILDER}|${DAY}`)?.costUsd).toBe(10);
  });

  it("counts changed historical receipt sets instead of keeping an old duplicate verdict", async () => {
    const store = memoryStore();
    const old = "2026-08-01";
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day({ day: old })]), NOW);
    await applySync(store, device(DEVICE_B), payload(DEVICE_B, [day({ day: old })]), NOW);
    await applySync(store, device(DEVICE_B, old), payload(DEVICE_B, [day({
      day: old, receipts: [...stream(10), ...stream(1, "b")],
    })]), NOW);
    expect(store.builderDays.get(`${BUILDER}|${old}`)?.costUsd).toBe(10);
  });

  it("does not match receipts owned only by a different model", async () => {
    const store = memoryStore();
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day()]), NOW);
    await applySync(store, device(DEVICE_B), payload(DEVICE_B, [day({ model: "other" })]), NOW);
    expect(store.builderDays.get(`${BUILDER}|${DAY}`)?.costUsd).toBe(10);
  });

  it("counts disjoint old receipt sets with identical or similar totals", async () => {
    const store = memoryStore();
    const old = "2026-08-01";
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day({ day: old })]), NOW);
    await applySync(store, device(DEVICE_B), payload(DEVICE_B, [day({
      day: old, receipts: stream(10, "b"), outputTokens: 950,
    })]), NOW);
    expect(store.builderDays.get(`${BUILDER}|${old}`)?.costUsd).toBe(10);
    expect([...store.usage.values()].map((row) => row.duplicateOfDeviceId)).toEqual([null, null]);
  });

  it("keeps the fingerprint after raw receipts expire and dedupes later exact copies", async () => {
    const store = memoryStore();
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day()]), NOW);
    const fingerprint = store.usage.get(`${DEVICE_A}|${DAY}|claude|claude-opus-5`)?.receiptFingerprint;
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    store.receipts.clear();
    const later = new Date("2026-09-01T12:00:00.000Z");
    for (const id of [DEVICE_B, DEVICE_A, DEVICE_B]) {
      await applySync(store, device(id), payload(id, [day()]), later);
      expect(store.builderDays.get(`${BUILDER}|${DAY}`)?.costUsd).toBe(5);
    }
    expect(store.receipts.size).toBe(0);
  });

  it("dedupes an exact copy of an old row stored before fingerprints", async () => {
    const store = memoryStore();
    const old = "2026-08-01";
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day({ day: old })]), NOW);
    store.usage.get(`${DEVICE_A}|${old}|claude|claude-opus-5`)!.receiptFingerprint = null;
    // A second Device's first Sync: different receipt hashes, every figure identical.
    const second = await applySync(store, device(DEVICE_B), payload(DEVICE_B, [day({
      day: old, receipts: stream(10, "b"),
    })]), NOW);
    expect(second.days[0]?.reasons.map((reason) => reason.code)).toContain("duplicate_of_device");
    expect(store.usage.get(`${DEVICE_B}|${old}|claude|claude-opus-5`)?.duplicateOfDeviceId).toBe(DEVICE_A);
    expect(store.builderDays.get(`${BUILDER}|${old}`)?.costUsd).toBe(5);
  });

  it.each([
    ["cost", { costUsd: 5.000001 }],
    ["input", { inputTokens: 5001 }],
    ["cached input", { cachedInputTokens: 200_001 }],
    ["cache write", { cacheWriteTokens: 20_001 }],
    ["output", { outputTokens: 1001 }],
    ["reasoning", { reasoningTokens: 1 }],
    ["receipt count", { receipts: stream(11) }],
  ] as const)("does not infer an old duplicate from an unfingerprinted row when %s differs", async (_, change) => {
    const store = memoryStore();
    const old = "2026-08-01";
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day({ day: old })]), NOW);
    store.usage.get(`${DEVICE_A}|${old}|claude|claude-opus-5`)!.receiptFingerprint = null;
    await applySync(store, device(DEVICE_B), payload(DEVICE_B, [day({ day: old, ...change })]), NOW);
    expect(store.usage.get(`${DEVICE_B}|${old}|claude|claude-opus-5`)?.duplicateOfDeviceId).toBeNull();
  });

  it("does not match an unfingerprinted old row that is itself a duplicate", async () => {
    const store = memoryStore();
    const old = "2026-08-01";
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day({ day: old })]), NOW);
    await applySync(store, device(DEVICE_B), payload(DEVICE_B, [day({ day: old })]), NOW);
    for (const row of store.usage.values()) row.receiptFingerprint = null;
    store.usage.delete(`${DEVICE_A}|${old}|claude|claude-opus-5`);
    await applySync(store, device(DEVICE_C), payload(DEVICE_C, [day({ day: old })]), NOW);
    expect(store.usage.get(`${DEVICE_C}|${old}|claude|claude-opus-5`)?.duplicateOfDeviceId).toBeNull();
  });

  it("counts matching recent and old totals without receipts on both devices", async () => {
    const store = memoryStore();
    const days = [day({ receipts: [] }), day({ day: "2026-08-01", receipts: [] })];
    for (const id of [DEVICE_A, DEVICE_B, DEVICE_A]) {
      await applySync(store, device(id), payload(id, days), NOW);
    }
    for (const row of store.usage.values()) {
      expect(row).toMatchObject({
        duplicateOfDeviceId: null, receiptFingerprint: null, trustLevel: "reported",
      });
    }
    expect([...store.builderDays.values()].map((row) => row.costUsd)).toEqual([10, 10]);
  });

  it("counts a second device that did different work", async () => {
    const store = memoryStore();
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day()]), NOW);
    await applySync(
      store,
      device(DEVICE_B),
      payload(DEVICE_B, [day({ receipts: stream(10, "b") })]),
      NOW,
    );

    expect(store.builderDays.get(`${BUILDER}|${DAY}`)?.costUsd).toBe(10);
  });

  it("keeps receipts only for days inside retention", async () => {
    const store = memoryStore();
    const old = "2026-08-01";
    await applySync(
      store,
      device(DEVICE_A),
      payload(DEVICE_A, [day(), day({ day: old, receipts: stream(10, "c") })]),
      NOW,
    );

    expect([...store.receipts.values()].map((row) => row.day)).toEqual(Array(10).fill(DAY));
    expect(receiptCutoffDay(NOW)).toBe("2026-08-11");
  });

  it("dedupes exact old copies from their receipt fingerprints", async () => {
    const store = memoryStore();
    const old = "2026-08-01";
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day({ day: old })]), NOW);
    const second = await applySync(
      store,
      device(DEVICE_B),
      payload(DEVICE_B, [day({ day: old, receipts: [...stream(10)].reverse() })]),
      NOW,
    );

    expect(second.days[0]?.reasons.map((reason) => reason.code)).toContain("duplicate_of_device");
    expect(store.builderDays.get(`${BUILDER}|${old}`)?.costUsd).toBe(5);
  });

  it("counts old days from another device that did different amounts of work", async () => {
    const store = memoryStore();
    const old = "2026-08-01";
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day({ day: old })]), NOW);
    await applySync(
      store,
      device(DEVICE_B),
      payload(DEVICE_B, [day({ day: old, outputTokens: 2000, receipts: stream(20, "b") })]),
      NOW,
    );

    expect(store.builderDays.get(`${BUILDER}|${old}`)?.costUsd).toBe(10);
  });

  it("is idempotent when the same device re-sends a day", async () => {
    const store = memoryStore();
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day()]), NOW);
    const again = await applySync(store, device(DEVICE_A, DAY), payload(DEVICE_A, [day()]), NOW);

    expect(again.days[0]?.trustLevel).toBe("verified");
    expect(store.builderDays.get(`${BUILDER}|${DAY}`)?.costUsd).toBe(5);
  });

  it("counts a very expensive day in full", async () => {
    const store = memoryStore();
    const result = await applySync(
      store,
      device(DEVICE_A),
      payload(DEVICE_A, [day({ costUsd: 9000, cachedInputTokens: 5_000_000_000 })]),
      NOW,
    );

    expect(result.days[0]).toMatchObject({ trustLevel: "verified", reasons: [] });
    expect(store.builderDays.get(`${BUILDER}|${DAY}`)).toMatchObject({ costUsd: 9000, trustLevelMin: "verified" });
  });

  it("answers, and does not store, a cost no price can reach for its tokens", async () => {
    const store = memoryStore();
    const result = await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day({ costUsd: 5000 })]), NOW);

    expect(result.days[0]?.trustLevel).toBe("quarantined");
    expect(result.days[0]?.reasons.map((reason) => reason.code)).toEqual(["cost_above_any_price"]);
    expect(store.usage.size).toBe(0);
  });

  it("answers, and does not store, a day that has not started", async () => {
    const store = memoryStore();
    const result = await applySync(
      store,
      device(DEVICE_A),
      payload(DEVICE_A, [day(), day({ day: "2026-08-18" })]),
      NOW,
    );

    expect(result.days.map((row) => row.trustLevel)).toEqual(["verified", "quarantined"]);
    expect(result.days[1]?.reasons.map((reason) => reason.code)).toEqual(["future_day"]);
    expect(result.nextWatermark).toBe(DAY);
    expect([...store.usage.keys()]).toEqual([`${DEVICE_A}|${DAY}|claude|claude-opus-5`]);
    expect(store.builderDays.has(`${BUILDER}|2026-08-18`)).toBe(false);
  });

  it("keeps a mixed day counted when one model has a thin stream, including re-syncs", async () => {
    const store = memoryStore();
    const days = [
      day({ costUsd: 415.37 }),
      day({ model: "claude-fable-5-1", outputTokens: 4, costUsd: 0.83, receipts: stream(682, "b") }),
    ];
    for (const watermark of [null, DAY]) {
      const result = await applySync(store, device(DEVICE_A, watermark), payload(DEVICE_A, days), NOW);
      expect(result.days.map((row) => row.trustLevel)).toEqual(["verified", "reported"]);
      expect(result.days[1]?.reasons.map((reason) => reason.code)).toEqual(["receipt_stream_thin"]);
      expect(result.nextWatermark).toBe(DAY);
      expect(store.builderDays.get(`${BUILDER}|${DAY}`)).toMatchObject({
        costUsd: 416.2,
        totalTokens: 451_004,
        trustLevelMin: "reported",
      });
      expect(store.usage.get(`${DEVICE_A}|${DAY}|claude|claude-opus-5`)).toMatchObject({
        trustLevel: "verified",
      });
      expect(store.usage.get(`${DEVICE_A}|${DAY}|claude|claude-fable-5-1`)).toMatchObject({
        trustLevel: "reported",
        quarantineReasons: [expect.objectContaining({ code: "receipt_stream_thin" })],
      });
    }
  });

  it("reports, and counts, a stream that cannot carry its tokens", async () => {
    const store = memoryStore();
    const result = await applySync(
      store,
      device(DEVICE_A),
      payload(DEVICE_A, [day({ outputTokens: 5_000_000, costUsd: 9000, receipts: stream(2) })]),
      NOW,
    );
    expect(result.days[0]?.trustLevel).toBe("reported");
    expect(result.days[0]?.reasons.map((reason) => reason.code)).toEqual(["receipt_stream_incoherent"]);
    expect(result.nextWatermark).toBe(DAY);
    expect(store.builderDays.get(`${BUILDER}|${DAY}`)).toMatchObject({ costUsd: 9000, trustLevelMin: "reported" });
  });

  it.each([false, true])("preserves existing usage on incomplete collection, with the 0.4.0 history flag: %s", async (reviewHistory) => {
    const store = memoryStore();
    const complete = day({ provider: "opencode", reasoningTokens: 200 });
    const other = day({ provider: "opencode", model: "another-model" });
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [complete, other]), NOW);
    const before = structuredClone([...store.usage.values()].find((row) => row.model === complete.model));
    const incomplete = { ...complete, reasoningTokens: 0, costUsd: 1, receipts: [], onlyIfMissing: true as const };
    const changedOther = { ...other, costUsd: 7 };
    await applySync(store, device(DEVICE_A), { ...payload(DEVICE_A, [incomplete, changedOther]),
      ...(reviewHistory ? { reviewHistory: true as const } : {}),
    }, NOW);
    expect([...store.usage.values()].find((row) => row.model === complete.model)).toEqual(before);
    expect([...store.usage.values()].find((row) => row.model === other.model)?.costUsd).toBe(7);
  });

  it("accepts missing incomplete usage as reported and later replaces it with complete usage", async () => {
    const store = memoryStore();
    const incomplete = day({ provider: "opencode", receipts: [], onlyIfMissing: true });
    const first = await applySync(store, device(DEVICE_A), payload(DEVICE_A, [incomplete]), NOW);
    expect(first.days[0].trustLevel).toBe("reported");
    expect([...store.usage.values()][0].costUsd).toBe(5);
    const complete = day({ provider: "opencode", reasoningTokens: 200, costUsd: 6 });
    const second = await applySync(store, device(DEVICE_A), payload(DEVICE_A, [complete]), NOW);
    expect(second.days[0].trustLevel).toBe("verified");
    expect([...store.usage.values()][0].reasoningTokens).toBe(200);
    expect([...store.usage.values()][0].costUsd).toBe(6);
  });

  it("adds newly discovered old usage even when collection is incomplete", async () => {
    const store = memoryStore();
    const incomplete = day({ day: "2026-08-01", receipts: [], onlyIfMissing: true });
    const result = await applySync(store, device(DEVICE_A, "2026-08-17"), payload(DEVICE_A, [incomplete]), NOW);
    expect(result.days[0]).toMatchObject({ trustLevel: "reported" });
    expect(result.days[0]?.reasons.map((reason) => reason.code)).toEqual(["no_receipt_stream"]);
    expect(store.builderDays.get(`${BUILDER}|2026-08-01`)).toMatchObject({ costUsd: 5, trustLevelMin: "reported" });
  });

  it("keeps old days counted when the device re-sends the same transcripts", async () => {
    const store = memoryStore();
    const old = "2026-08-01";
    const days = [
      day({ day: old }),
      day({ day: old, provider: "codex", model: "gpt-6-luna", receipts: [] }),
      day(),
    ];
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, days), NOW);

    // `sync --since 120` after the first sync: same transcripts, watermark now at DAY.
    const again = await applySync(store, device(DEVICE_A, DAY), payload(DEVICE_A, days), NOW);

    expect(again.days.map((row) => row.trustLevel)).toEqual(["verified", "reported", "verified"]);
    expect(again.days[1]?.reasons.map((reason) => reason.code)).toEqual(["no_receipt_stream"]);
    expect(store.usage.get(`${DEVICE_A}|${old}|claude|claude-opus-5`)).toMatchObject({ costUsd: 5, trustLevel: "verified" });
    expect(store.builderDays.get(`${BUILDER}|${old}`)).toMatchObject({
      costUsd: 10,
      trustLevelMin: "reported",
    });
    expect(again.nextWatermark).toBe(DAY);
  });

  it("raises an old day when the machine now reports more", async () => {
    const store = memoryStore();
    const old = "2026-08-01";
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day({ day: old })]), NOW);
    const again = await applySync(
      store,
      device(DEVICE_A, DAY),
      payload(DEVICE_A, [day({ day: old, costUsd: 500, outputTokens: 90_000, receipts: stream(12) })]),
      NOW,
    );

    expect(again.days[0]).toMatchObject({ trustLevel: "verified", reasons: [] });
    expect(store.usage.get(`${DEVICE_A}|${old}|claude|claude-opus-5`)?.costUsd).toBe(500);
    expect(store.builderDays.get(`${BUILDER}|${old}`)).toMatchObject({ costUsd: 500, trustLevelMin: "verified" });
  });

  it("corrects an old estimate downwards when the re-read saw at least the same messages", async () => {
    const store = memoryStore();
    const old = "2026-08-01";
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day({ day: old, costUsd: 9, reasoningTokens: 800 })]), NOW);
    await applySync(store, device(DEVICE_A, DAY), payload(DEVICE_A, [day({ day: old, costUsd: 6 })]), NOW);

    expect(store.usage.get(`${DEVICE_A}|${old}|claude|claude-opus-5`)).toMatchObject({ costUsd: 6, reasoningTokens: 0 });
    expect(store.builderDays.get(`${BUILDER}|${old}`)?.costUsd).toBe(6);
  });

  it.each([
    ["fewer receipts and fewer tokens", { receipts: stream(6), outputTokens: 600, costUsd: 3 }],
    ["no receipts and fewer tokens", { receipts: [], outputTokens: 600, costUsd: 3 }],
  ] as [string, Partial<SyncDay>][])("never lowers an old day when the re-read has %s", async (_, change) => {
    const store = memoryStore();
    const old = "2026-08-01";
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day({ day: old })]), NOW);
    const again = await applySync(store, device(DEVICE_A, DAY), payload(DEVICE_A, [day({ day: old, ...change })]), NOW);

    expect(again.days[0]).toMatchObject({ trustLevel: "verified", reasons: [] });
    expect(store.usage.get(`${DEVICE_A}|${old}|claude|claude-opus-5`)).toMatchObject({ costUsd: 5, receiptCount: 10 });
    expect(store.builderDays.get(`${BUILDER}|${old}`)?.costUsd).toBe(5);
  });

  it("raises an old day without receipts only when the tokens do not drop", async () => {
    const store = memoryStore();
    const old = "2026-08-01";
    const codex = (overrides: Partial<SyncDay>) =>
      day({ day: old, provider: "codex", model: "gpt-6-luna", receipts: [], ...overrides });
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [codex({})]), NOW);

    // Same tokens at a lower price, now with receipts: the same work, priced again.
    await applySync(store, device(DEVICE_A, DAY), payload(DEVICE_A, [codex({ costUsd: 4, receipts: stream(10) })]), NOW);
    expect(store.usage.get(`${DEVICE_A}|${old}|codex|gpt-6-luna`)).toMatchObject({ costUsd: 4, trustLevel: "verified" });

    // Fewer receipts than stored now, and fewer tokens: part of the history is gone.
    await applySync(store, device(DEVICE_A, DAY), payload(DEVICE_A, [codex({ costUsd: 2, outputTokens: 10, receipts: stream(3) })]), NOW);
    expect(store.usage.get(`${DEVICE_A}|${old}|codex|gpt-6-luna`)).toMatchObject({ costUsd: 4, receiptCount: 10 });
  });

  it("raises an old day with fewer receipts when its tokens still grew", async () => {
    const store = memoryStore();
    const old = "2026-08-01";
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day({ day: old })]), NOW);
    await applySync(store, device(DEVICE_A, DAY), payload(DEVICE_A, [day({ day: old, receipts: stream(8), outputTokens: 1200, costUsd: 6 })]), NOW);
    expect(store.usage.get(`${DEVICE_A}|${old}|claude|claude-opus-5`)).toMatchObject({ costUsd: 6, receiptCount: 8 });
  });

  it("ignores the 0.4.0 history flag and never quarantines a day for its age", async () => {
    const store = memoryStore();
    const [same, changed, fresh] = ["2026-08-01", "2026-08-02", "2026-08-04"];
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day({ day: same }), day({ day: changed }), day()]), NOW);

    // `sync --since 30 --review-history` from 0.4.0: the same transcripts, one corrected day, one new one.
    const review = await applySync(store, device(DEVICE_A, DAY), {
      ...payload(DEVICE_A, [
        day({ day: same, receipts: [...stream(10)].reverse() }),
        day({ day: changed, costUsd: 6 }),
        day({ day: fresh }),
        day(),
      ]),
      reviewHistory: true,
    }, NOW);

    expect(review.days.map((row) => row.trustLevel)).toEqual(["verified", "verified", "verified", "verified"]);
    expect(store.usage.get(`${DEVICE_A}|${changed}|claude|claude-opus-5`)?.costUsd).toBe(6);
    for (const rowDay of [same, changed, fresh, DAY]) {
      expect(store.builderDays.get(`${BUILDER}|${rowDay}`)?.trustLevelMin).toBe("verified");
    }
  });

  it("restores an old row quarantined for its age when the device sends it again", async () => {
    const store = memoryStore();
    const old = "2026-08-01";
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day({ day: old })]), NOW);
    // What 0.4.0's `--review-history` left behind.
    const row = store.usage.get(`${DEVICE_A}|${old}|claude|claude-opus-5`)!;
    row.trustLevel = "quarantined";
    row.quarantineReasons = [{ code: "stale_backfill", message: "Day is older than this Device's backfill window." }];

    const again = await applySync(store, device(DEVICE_A, DAY), payload(DEVICE_A, [day({ day: old })]), NOW);
    expect(again.days[0]).toMatchObject({ trustLevel: "verified", reasons: [] });
    expect(store.builderDays.get(`${BUILDER}|${old}`)).toMatchObject({ costUsd: 5, trustLevelMin: "verified" });
  });

  it("leaves a row an Admin kept out as it is", async () => {
    const store = memoryStore();
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day()]), NOW);
    const row = store.usage.get(`${DEVICE_A}|${DAY}|claude|claude-opus-5`)!;
    row.trustLevel = "quarantined";
    row.quarantineReasons = [{ code: "daily_cost_ceiling", message: "big" }];
    store.keptOut.add(`${DEVICE_A}|${DAY}|claude|claude-opus-5`);

    const again = await applySync(store, device(DEVICE_A, DAY), payload(DEVICE_A, [day({ costUsd: 9 })]), NOW);
    expect(again.days[0]?.trustLevel).toBe("quarantined");
    expect(store.usage.get(`${DEVICE_A}|${DAY}|claude|claude-opus-5`)).toMatchObject({ trustLevel: "quarantined", costUsd: 5 });
  });

  it("reviews an old row whose receipt set changed even when its figures did not", async () => {
    const store = memoryStore();
    const old = "2026-08-01";
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day({ day: old })]), NOW);
    const again = await applySync(store, device(DEVICE_A, DAY), payload(DEVICE_A, [day({ day: old, receipts: stream(10, "b") })]), NOW);
    expect(again.days[0]).toMatchObject({ trustLevel: "verified", reasons: [] });
    expect(store.usage.get(`${DEVICE_A}|${old}|claude|claude-opus-5`)?.receiptFingerprint).toBe(receiptFingerprint(stream(10, "b")));
  });

  it("lets incomplete collection refresh a stored row without receipts inside the backfill window", async () => {
    const store = memoryStore();
    const incomplete = (costUsd: number) =>
      day({ provider: "opencode", receipts: [], costUsd, onlyIfMissing: true });
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [incomplete(5)]), NOW);
    const later = await applySync(store, device(DEVICE_A, DAY), payload(DEVICE_A, [incomplete(7)]), NOW);
    expect(later.days[0]?.trustLevel).toBe("reported");
    expect(store.usage.get(`${DEVICE_A}|${DAY}|opencode|claude-opus-5`)?.costUsd).toBe(7);
    expect(store.builderDays.get(`${BUILDER}|${DAY}`)?.costUsd).toBe(7);
  });

  it("keeps a stored row without receipts past the backfill window on incomplete collection", async () => {
    const store = memoryStore();
    const old = "2026-08-01";
    const incomplete = (costUsd: number) =>
      day({ day: old, provider: "opencode", receipts: [], costUsd, onlyIfMissing: true });
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [incomplete(5)]), NOW);
    await applySync(store, device(DEVICE_A, DAY), payload(DEVICE_A, [incomplete(7)]), NOW);
    expect(store.usage.get(`${DEVICE_A}|${old}|opencode|claude-opus-5`)?.costUsd).toBe(5);
  });

  it("asks for every recent row's foreign receipts in one call", async () => {
    const store = memoryStore();
    const days = [day(), day({ model: "claude-fable-5-1", receipts: stream(10, "b") }), day({ receipts: [], provider: "gemini" })];
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, days), NOW);
    store.foreignReceiptCalls.length = 0;
    const second = await applySync(store, device(DEVICE_B), payload(DEVICE_B, days), NOW);
    expect(store.foreignReceiptCalls).toEqual([2]);
    expect(second.days.map((row) => row.reasons.map((reason) => reason.code))).toEqual([
      ["duplicate_of_device"], ["duplicate_of_device"], ["no_receipt_stream"],
    ]);
  });

  it("does not mistake a new row past the backfill window for a stored one with a similar name", async () => {
    const store = memoryStore();
    const old = "2026-08-01";
    await applySync(
      store,
      device(DEVICE_A),
      payload(DEVICE_A, [day({ day: old, provider: "claude|opus", model: "5", costUsd: 9 })]),
      NOW,
    );
    await applySync(
      store,
      device(DEVICE_A, DAY),
      payload(DEVICE_A, [day({ day: old, provider: "claude", model: "opus|5", receipts: stream(2), outputTokens: 10 })]),
      NOW,
    );

    // Read as the stored row, the new one would be kept: fewer receipts, fewer tokens.
    // It was written instead. The memory store's own key joins with "|", so it lands on the same entry.
    expect(store.usage.get(`${DEVICE_A}|${old}|claude|opus|5`)).toMatchObject({ provider: "claude", receiptCount: 2 });
  });

  it("adds a day that arrives for the first time past the backfill window", async () => {
    const store = memoryStore();
    const old = "2026-08-01";
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day()]), NOW);
    const late = await applySync(
      store,
      device(DEVICE_A, DAY),
      payload(DEVICE_A, [day({ day: old }), day()]),
      NOW,
    );

    expect(late.days.map((row) => row.trustLevel)).toEqual(["verified", "verified"]);
    expect(store.builderDays.get(`${BUILDER}|${old}`)).toMatchObject({ costUsd: 5, trustLevelMin: "verified" });
  });

  it("reports a day with no Receipt Stream", async () => {
    const store = memoryStore();
    const result = await applySync(
      store,
      device(DEVICE_A),
      payload(DEVICE_A, [day({ provider: "gemini", model: "gemini-3-pro", receipts: [] })]),
      NOW,
    );

    expect(result.days[0]?.trustLevel).toBe("reported");
    expect(result.days[0]?.reasons.map((reason) => reason.code)).toEqual(["no_receipt_stream"]);
  });
});

describe("one machine counts once", () => {
  const OLD = "2026-08-01";
  const LATER = new Date("2026-08-17T13:00:00.000Z");
  const at = (when: Date, id: string, days: SyncDay[]) => ({ ...payload(id, days), sentAt: when.toISOString() });
  const row = (store: Memory, id: string, rowDay = OLD) => store.usage.get(`${id}|${rowDay}|claude|claude-opus-5`);

  it("counts the newer reading when it saw at least the same messages", async () => {
    const store = memoryStore();
    store.machines.set(DEVICE_B, DEVICE_A);
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day({ day: OLD })]), NOW);
    // The same machine connected again: a new key, a newer collector, the same transcripts.
    const second = await applySync(
      store,
      device(DEVICE_B),
      at(LATER, DEVICE_B, [day({ day: OLD, receipts: stream(10, "b"), costUsd: 6 })]),
      LATER,
    );

    expect(second.days[0]).toMatchObject({ trustLevel: "verified", reasons: [] });
    expect(row(store, DEVICE_B)).toMatchObject({ duplicateOfDeviceId: null, trustLevel: "verified" });
    expect(row(store, DEVICE_A)).toMatchObject({
      duplicateOfDeviceId: DEVICE_B,
      trustLevel: "reported",
      quarantineReasons: [expect.objectContaining({ code: "same_machine" })],
    });
    expect(store.builderDays.get(`${BUILDER}|${OLD}`)).toMatchObject({ costUsd: 6, trustLevelMin: "verified" });
  });

  it("keeps the older reading when the newer one lost part of the day", async () => {
    const store = memoryStore();
    store.machines.set(DEVICE_B, DEVICE_A);
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day({ day: OLD })]), NOW);
    const second = await applySync(
      store,
      device(DEVICE_B),
      at(LATER, DEVICE_B, [day({ day: OLD, receipts: stream(4, "b"), outputTokens: 400, costUsd: 2 })]),
      LATER,
    );

    expect(second.days[0]?.reasons.map((reason) => reason.code)).toEqual(["same_machine"]);
    expect(row(store, DEVICE_A)?.duplicateOfDeviceId).toBeNull();
    expect(row(store, DEVICE_B)?.duplicateOfDeviceId).toBe(DEVICE_A);
    expect(store.builderDays.get(`${BUILDER}|${OLD}`)?.costUsd).toBe(5);
  });

  it("keeps one counted copy while two devices on one machine take turns", async () => {
    const store = memoryStore();
    store.machines.set(DEVICE_B, DEVICE_A);
    const hour = (h: number) => new Date(`2026-08-17T${String(h).padStart(2, "0")}:00:00.000Z`);
    for (const [index, id] of [DEVICE_A, DEVICE_B, DEVICE_A, DEVICE_B].entries()) {
      const when = hour(12 + index);
      await applySync(store, device(id), at(when, id, [day()]), when);
      expect(store.builderDays.get(`${BUILDER}|${DAY}`)?.costUsd).toBe(5);
      expect([...store.usage.values()].filter((each) => each.duplicateOfDeviceId === null)).toHaveLength(1);
    }
  });

  it("adds up different machines, and leaves a copy another machine owns alone", async () => {
    const store = memoryStore();
    store.machines.set(DEVICE_B, DEVICE_A);
    await applySync(store, device(DEVICE_C), payload(DEVICE_C, [day()]), NOW);
    await applySync(store, device(DEVICE_A), at(LATER, DEVICE_A, [day()]), LATER);
    await applySync(store, device(DEVICE_B), at(LATER, DEVICE_B, [day({ receipts: stream(10, "b") })]), LATER);

    expect(row(store, DEVICE_A, DAY)?.duplicateOfDeviceId).toBe(DEVICE_C);
    expect(row(store, DEVICE_B, DAY)?.duplicateOfDeviceId).toBeNull();
    expect(store.builderDays.get(`${BUILDER}|${DAY}`)?.costUsd).toBe(10);
  });

  it("recounts history when a Builder marks two devices as one machine, and again when they split", async () => {
    const store = memoryStore();
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day({ day: OLD }), day()]), NOW);
    await applySync(store, device(DEVICE_B), at(LATER, DEVICE_B, [day({ day: OLD, receipts: stream(10, "b"), costUsd: 6 })]), LATER);
    expect(store.builderDays.get(`${BUILDER}|${OLD}`)?.costUsd).toBe(11);

    store.machines.set(DEVICE_B, DEVICE_A);
    expect(await regroupMachines(store, BUILDER, [DEVICE_A], LATER)).toBe(1);
    expect(store.builderDays.get(`${BUILDER}|${OLD}`)).toMatchObject({ costUsd: 6, trustLevelMin: "verified" });
    expect(row(store, DEVICE_A)?.duplicateOfDeviceId).toBe(DEVICE_B);
    expect(store.builderDays.get(`${BUILDER}|${DAY}`)?.costUsd).toBe(5);

    store.machines.delete(DEVICE_B);
    expect(await regroupMachines(store, BUILDER, [DEVICE_A, DEVICE_B], LATER)).toBe(1);
    expect(row(store, DEVICE_A)).toMatchObject({ duplicateOfDeviceId: null, trustLevel: "verified", quarantineReasons: [] });
    expect(store.builderDays.get(`${BUILDER}|${OLD}`)?.costUsd).toBe(11);
  });

  it("does not let a quarantined copy hold back the day another copy counts for", async () => {
    const store = memoryStore();
    store.machines.set(DEVICE_B, DEVICE_A);
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day({ day: OLD })]), NOW);
    const stale = row(store, DEVICE_A)!;
    stale.trustLevel = "quarantined";
    stale.quarantineReasons = [{ code: "future_day", message: "Day starts in the future." }];
    store.keptOut.add(`${DEVICE_A}|${OLD}|claude|claude-opus-5`);

    await applySync(store, device(DEVICE_B), at(LATER, DEVICE_B, [day({ day: OLD, receipts: stream(4, "b"), outputTokens: 400, costUsd: 2 })]), LATER);
    expect(row(store, DEVICE_A)).toMatchObject({ trustLevel: "quarantined", duplicateOfDeviceId: DEVICE_B });
    expect(store.builderDays.get(`${BUILDER}|${OLD}`)).toMatchObject({ costUsd: 2, trustLevelMin: "verified" });
  });
  it("recounts both machines when Settings moves the device while it syncs", async () => {
    const store = memoryStore();
    await applySync(store, device(DEVICE_B), payload(DEVICE_B, [day({ day: OLD, receipts: stream(10, "b"), costUsd: 6 })]), NOW);
    let reads = 0;
    const racing: Memory = {
      ...store,
      async machineOf(deviceId) {
        reads += 1;
        const machine = await store.machineOf(deviceId);
        if (reads === 1) {
          // Settings merges A into B's machine and recounts, after this Sync read A's machine.
          store.machines.set(DEVICE_A, DEVICE_B);
          await regroupMachines(store, BUILDER, [DEVICE_A, DEVICE_B], LATER);
        }
        return machine;
      },
    };
    await applySync(racing, device(DEVICE_A), at(LATER, DEVICE_A, [day({ day: OLD })]), LATER);

    expect([...store.usage.values()].filter((each) => each.duplicateOfDeviceId === null)).toHaveLength(1);
    expect(store.builderDays.get(`${BUILDER}|${OLD}`)?.costUsd).toBe(5);
  });

  it("recounts when Settings moves another device onto this machine while it syncs", async () => {
    const store = memoryStore();
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day({ day: OLD })]), NOW);
    await applySync(store, device(DEVICE_B), payload(DEVICE_B, [day({ day: OLD, receipts: stream(10, "b"), costUsd: 6 })]), NOW);
    let reads = 0;
    const racing: Memory = {
      ...store,
      async machineMembers(builderId, machineId) {
        reads += 1;
        const members = await store.machineMembers(builderId, machineId);
        if (reads === 1) {
          // Settings merges B into A's machine and recounts, after this Sync read A's machine.
          store.machines.set(DEVICE_B, DEVICE_A);
          await regroupMachines(store, BUILDER, [DEVICE_A, DEVICE_B], LATER);
        }
        return members;
      },
    };
    await applySync(racing, device(DEVICE_A), at(LATER, DEVICE_A, [day({ day: OLD })]), LATER);

    expect([...store.usage.values()].filter((each) => each.duplicateOfDeviceId === null)).toHaveLength(1);
    expect(store.builderDays.get(`${BUILDER}|${OLD}`)?.costUsd).toBe(5);
  });

  it("keeps one counted row when two devices on one machine upload the same day at once", async () => {
    const store = memoryStore();
    store.machines.set(DEVICE_B, DEVICE_A);
    let reads = 0;
    const racing: Memory = {
      ...store,
      async usageOfDevices(deviceIds, days) {
        reads += 1;
        const rows = await store.usageOfDevices(deviceIds, days);
        // B's whole Sync lands after A read the machine's rows and before A writes.
        if (reads === 1) {
          await applySync(store, device(DEVICE_B), payload(DEVICE_B, [day({ day: OLD, receipts: stream(10, "b"), costUsd: 6 })]), NOW);
        }
        return rows;
      },
    };
    await applySync(racing, device(DEVICE_A), at(LATER, DEVICE_A, [day({ day: OLD })]), LATER);

    expect([...store.usage.values()].filter((each) => each.duplicateOfDeviceId === null)).toHaveLength(1);
    expect(store.builderDays.get(`${BUILDER}|${OLD}`)?.costUsd).toBe(5);
  });

  it("lets a device that left the machine during a sync count again", async () => {
    const store = memoryStore();
    store.machines.set(DEVICE_B, DEVICE_A);
    await applySync(store, device(DEVICE_B), payload(DEVICE_B, [day({ day: OLD, receipts: stream(10, "b"), costUsd: 6 })]), NOW);
    let reads = 0;
    const racing: Memory = {
      ...store,
      async usageOfDevices(deviceIds, days) {
        reads += 1;
        const rows = await store.usageOfDevices(deviceIds, days);
        if (reads === 1) {
          // Settings splits B off after A read the machine, and recounts both machines.
          store.machines.delete(DEVICE_B);
          await regroupMachines(store, BUILDER, [DEVICE_A, DEVICE_B], LATER);
        }
        return rows;
      },
    };
    await applySync(racing, device(DEVICE_A), at(LATER, DEVICE_A, [day({ day: OLD })]), LATER);

    expect(row(store, DEVICE_A)?.duplicateOfDeviceId).toBeNull();
    expect(row(store, DEVICE_B)?.duplicateOfDeviceId).toBeNull();
    expect(store.builderDays.get(`${BUILDER}|${OLD}`)?.costUsd).toBe(11);
  });

  it("repairs the totals when a recount is run again after it stopped halfway", async () => {
    const store = memoryStore();
    store.machines.set(DEVICE_B, DEVICE_A);
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day({ day: OLD })]), NOW);
    await applySync(store, device(DEVICE_B), at(LATER, DEVICE_B, [day({ day: OLD, receipts: stream(10, "b"), costUsd: 6 })]), LATER);
    store.builderDays.set(`${BUILDER}|${OLD}`, { builderId: BUILDER, day: OLD, costUsd: 11, totalTokens: 0, trustLevelMin: "verified" });

    expect(await regroupMachines(store, BUILDER, [DEVICE_A], LATER)).toBe(0);
    expect(store.builderDays.get(`${BUILDER}|${OLD}`)?.costUsd).toBe(6);
  });
});

describe("restoreRetiredQuarantines", () => {
  const OLD = "2026-08-01";
  const quarantine = (store: Memory, id: string, rowDay: string, reasons: { code: string; message: string }[]) => {
    const row = store.usage.get(`${id}|${rowDay}|claude|claude-opus-5`)!;
    row.trustLevel = "quarantined";
    row.quarantineReasons = reasons;
  };

  it("puts back rows that only retired checks held back, and leaves the rest", async () => {
    const store = memoryStore();
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [
      day({ day: OLD }),
      day({ day: "2026-08-02", receipts: [] }),
      day({ day: "2026-08-03" }),
      day({ day: "2026-08-04" }),
    ]), NOW);
    await applySync(store, device(DEVICE_B), payload(DEVICE_B, [day({ day: OLD })]), NOW);
    quarantine(store, DEVICE_A, OLD, [{ code: "stale_backfill", message: "old" }]);
    quarantine(store, DEVICE_B, OLD, [{ code: "stale_backfill", message: "old" }, { code: "duplicate_of_device", message: "copy" }]);
    quarantine(store, DEVICE_A, "2026-08-02", [{ code: "daily_cost_ceiling", message: "big" }]);
    quarantine(store, DEVICE_A, "2026-08-03", [{ code: "future_day", message: "future" }]);
    quarantine(store, DEVICE_A, "2026-08-04", [{ code: "stale_backfill", message: "old" }]);
    store.keptOut.add(`${DEVICE_A}|2026-08-04|claude|claude-opus-5`);
    store.builderDays.clear();

    expect(await restoreRetiredQuarantines(store, NOW)).toBe(4);
    const row = (id: string, rowDay: string) => store.usage.get(`${id}|${rowDay}|claude|claude-opus-5`);
    expect(row(DEVICE_A, OLD)).toMatchObject({ trustLevel: "verified", quarantineReasons: [] });
    expect(row(DEVICE_B, OLD)).toMatchObject({
      trustLevel: "reported",
      duplicateOfDeviceId: DEVICE_A,
      quarantineReasons: [expect.objectContaining({ code: "duplicate_of_device" })],
    });
    expect(row(DEVICE_A, "2026-08-02")).toMatchObject({
      trustLevel: "reported",
      quarantineReasons: [expect.objectContaining({ code: "no_receipt_stream" })],
    });
    // Held for a day that had not started; that day has begun since.
    expect(row(DEVICE_A, "2026-08-03")).toMatchObject({ trustLevel: "verified", quarantineReasons: [] });
    expect(row(DEVICE_A, "2026-08-04")?.trustLevel).toBe("quarantined");
    expect(store.builderDays.get(`${BUILDER}|${OLD}`)).toMatchObject({ costUsd: 5, trustLevelMin: "verified" });
    expect(store.builderDays.get(`${BUILDER}|2026-08-02`)).toMatchObject({ costUsd: 5, trustLevelMin: "reported" });
    expect(store.builderDays.get(`${BUILDER}|2026-08-03`)?.trustLevelMin).toBe("verified");

    expect(await restoreRetiredQuarantines(store, NOW)).toBe(0);
  });

  it("counts one machine once when both of its copies come back", async () => {
    const store = memoryStore();
    store.machines.set(DEVICE_B, DEVICE_A);
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day({ day: OLD })]), NOW);
    await applySync(store, device(DEVICE_B), payload(DEVICE_B, [day({ day: OLD, receipts: stream(10, "b"), costUsd: 6 })]), NOW);
    for (const id of [DEVICE_A, DEVICE_B]) {
      const row = store.usage.get(`${id}|${OLD}|claude|claude-opus-5`)!;
      row.trustLevel = "quarantined";
      row.duplicateOfDeviceId = null;
      row.quarantineReasons = [{ code: "stale_backfill", message: "old" }];
    }

    expect(await restoreRetiredQuarantines(store, NOW)).toBe(2);
    expect([...store.usage.values()].filter((row) => row.duplicateOfDeviceId === null)).toHaveLength(1);
    expect(store.builderDays.get(`${BUILDER}|${OLD}`)?.costUsd).toBe(6);
  });

  it("finishes the recount on the next run when the last one stopped after restoring rows", async () => {
    const store = memoryStore();
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day({ day: OLD })]), NOW);
    const row = store.usage.get(`${DEVICE_A}|${OLD}|claude|claude-opus-5`)!;
    row.trustLevel = "verified";
    row.quarantineReasons = [];
    store.builderDays.set(`${BUILDER}|${OLD}`, { builderId: BUILDER, day: OLD, costUsd: 5, totalTokens: 226_000, trustLevelMin: "quarantined" });

    expect(await restoreRetiredQuarantines(store, NOW)).toBe(0);
    expect(store.builderDays.get(`${BUILDER}|${OLD}`)?.trustLevelMin).toBe("verified");
  });
  it("does not recount a Builder every night because an Admin kept a row out", async () => {
    const store = memoryStore();
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day({ day: OLD })]), NOW);
    const row = store.usage.get(`${DEVICE_A}|${OLD}|claude|claude-opus-5`)!;
    row.trustLevel = "quarantined";
    row.quarantineReasons = [{ code: "stale_backfill", message: "old" }];
    store.keptOut.add(`${DEVICE_A}|${OLD}|claude|claude-opus-5`);
    store.builderDays.get(`${BUILDER}|${OLD}`)!.trustLevelMin = "quarantined";
    let reads = 0;
    const counting: Memory = {
      ...store,
      async usageOfDevices(deviceIds, days) {
        reads += 1;
        return store.usageOfDevices(deviceIds, days);
      },
    };

    expect(await restoreRetiredQuarantines(counting, NOW)).toBe(0);
    expect(reads).toBe(0);
  });

  it("does not let back in a row an Admin kept out while the restore ran", async () => {
    const store = memoryStore();
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day({ day: OLD })]), NOW);
    const stale = store.usage.get(`${DEVICE_A}|${OLD}|claude|claude-opus-5`)!;
    stale.trustLevel = "quarantined";
    stale.quarantineReasons = [{ code: "stale_backfill", message: "old" }];
    const racing: Memory = {
      ...store,
      async quarantinedUsage(builderId) {
        const rows = await store.quarantinedUsage(builderId);
        store.keptOut.add(`${DEVICE_A}|${OLD}|claude|claude-opus-5`);
        return rows;
      },
    };
    await restoreRetiredQuarantines(racing, NOW);
    expect(store.usage.get(`${DEVICE_A}|${OLD}|claude|claude-opus-5`)?.trustLevel).toBe("quarantined");
  });
});

describe("reconcileBuilderDays", () => {
  it("rebuilds days whose totals a stopped write left behind, and only those", async () => {
    const store = memoryStore();
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day({ day: "2026-08-01" }), day({ day: "2026-08-02" }), day()]), NOW);
    store.builderDays.set(`${BUILDER}|2026-08-01`, { builderId: BUILDER, day: "2026-08-01", costUsd: 1, totalTokens: 1, trustLevelMin: "quarantined" });
    store.builderDays.delete(`${BUILDER}|2026-08-02`);

    expect(await reconcileBuilderDays(store)).toBe(2);
    expect(store.builderDays.get(`${BUILDER}|2026-08-01`)).toMatchObject({ costUsd: 5, trustLevelMin: "verified" });
    expect(store.builderDays.get(`${BUILDER}|2026-08-02`)).toMatchObject({ costUsd: 5, trustLevelMin: "verified" });
    expect(await reconcileBuilderDays(store)).toBe(0);
  });
});


describe("nextWatermark", () => {
  const outcome = (day: string, trustLevel: "verified" | "quarantined") => ({
    day,
    provider: "claude",
    model: "claude-opus-5",
    trustLevel,
    reasons: [],
  });

  it("takes the newest accepted day", () => {
    expect(nextWatermark(null, [outcome("2026-08-15", "verified"), outcome("2026-08-16", "verified")]))
      .toBe("2026-08-16");
  });

  it("never moves backwards", () => {
    expect(nextWatermark("2026-08-16", [outcome("2026-08-14", "verified")])).toBe("2026-08-16");
  });

  it("ignores quarantined days", () => {
    expect(nextWatermark("2026-08-16", [outcome("2026-09-01", "quarantined")])).toBe("2026-08-16");
  });
});

describe("receiptFingerprint", () => {
  it("hashes a sorted set and keeps empty evidence unknown", () => {
    expect(receiptFingerprint([])).toBeNull();
    expect(receiptFingerprint(stream(10))).toBe(receiptFingerprint([...stream(10)].reverse()));
    expect(receiptFingerprint(stream(10))).toBe(receiptFingerprint([...stream(10), ...stream(10)]));
    expect(receiptFingerprint(stream(10))).not.toBe(receiptFingerprint(stream(10, "b")));
  });
});
