/*
  Sync behaviour against an in-memory store: the same code the route runs, with
  maps instead of Postgres. What is being pinned down is the dedupe rule, the
  Trust Level a failed check produces, and how the watermark moves.
*/
import { describe, expect, it } from "vitest";
import type { SyncDay, SyncPayload } from "@tokenburnmarket/core";
import {
  applySync,
  nextWatermark,
  receiptCutoffDay,
  receiptFingerprint,
  type BuilderDayWrite,
  type ReceiptWrite,
  type ReceiptOwners,
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

interface Memory extends SyncStore {
  receipts: Map<string, ReceiptWrite>;
  usage: Map<string, UsageRowWrite>;
  builderDays: Map<string, BuilderDayWrite>;
  watermarks: Map<string, string | null>;
}

function memoryStore(): Memory {
  const receipts = new Map<string, ReceiptWrite>();
  const usage = new Map<string, UsageRowWrite>();
  const builderDays = new Map<string, BuilderDayWrite>();
  const watermarks = new Map<string, string | null>();

  return {
    receipts,
    usage,
    builderDays,
    watermarks,
    async foreignReceipts(builderId, deviceId, hashes, incoming) {
      const owners: ReceiptOwners = new Map();
      for (const row of receipts.values()) {
        if (row.builderId !== builderId || row.deviceId === deviceId) continue;
        const owner = usage.get(`${row.deviceId}|${incoming.day}|${incoming.provider}|${incoming.model}`);
        if (row.day !== incoming.day || !owner || owner.duplicateOfDeviceId !== null) continue;
        if (!hashes.includes(row.hash)) continue;
        const devices = owners.get(row.hash) ?? new Set<string>();
        devices.add(row.deviceId);
        owners.set(row.hash, devices);
      }
      return owners;
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
      return [...usage.values()].filter((row) => row.deviceId === deviceId && days.includes(row.day));
    },
    async putUsageRows(rows) {
      for (const row of rows) {
        usage.set(`${row.deviceId}|${row.day}|${row.provider}|${row.model}`, row);
      }
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

  it("does not infer an old duplicate when the stored fingerprint is unknown", async () => {
    const store = memoryStore();
    const old = "2026-08-01";
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day({ day: old })]), NOW);
    store.usage.get(`${DEVICE_A}|${old}|claude|claude-opus-5`)!.receiptFingerprint = null;
    await applySync(store, device(DEVICE_B), payload(DEVICE_B, [day({ day: old })]), NOW);
    expect(store.builderDays.get(`${BUILDER}|${old}`)?.costUsd).toBe(10);
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

  it("quarantines a day that fails a plausibility check and keeps it out of the watermark", async () => {
    const store = memoryStore();
    const result = await applySync(
      store,
      device(DEVICE_A),
      payload(DEVICE_A, [day({ costUsd: 9000 })]),
      NOW,
    );

    expect(result.days[0]?.trustLevel).toBe("quarantined");
    expect(result.days[0]?.reasons.map((reason) => reason.code)).toContain("daily_cost_ceiling");
    expect(result.nextWatermark).toBeNull();
    expect(store.builderDays.get(`${BUILDER}|${DAY}`)?.trustLevelMin).toBe("quarantined");
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
      expect(store.usage.get(`${DEVICE_A}|${DAY}|claude|claude-fable-5-1`)).toMatchObject({
        trustLevel: "reported",
        quarantineReasons: [expect.objectContaining({ code: "receipt_stream_thin" })],
      });
    }
  });

  it("still quarantines the whole day when a thin stream also exceeds a ceiling", async () => {
    const store = memoryStore();
    const result = await applySync(
      store,
      device(DEVICE_A),
      payload(DEVICE_A, [day({ outputTokens: 4, costUsd: 9000, receipts: stream(682) })]),
      NOW,
    );
    expect(result.days[0]?.trustLevel).toBe("quarantined");
    expect(result.days[0]?.reasons.map((reason) => reason.code)).toEqual([
      "daily_cost_ceiling", "receipt_stream_thin",
    ]);
    expect(result.nextWatermark).toBeNull();
    expect(store.builderDays.get(`${BUILDER}|${DAY}`)?.trustLevelMin).toBe("quarantined");
  });

  it("keeps accepted days as they were when the device re-sends them past the backfill window", async () => {
    const store = memoryStore();
    const old = "2026-08-01";
    const days = [
      day({ day: old }),
      day({ day: old, provider: "codex", model: "gpt-6-luna", receipts: [] }),
      day(),
    ];
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, days), NOW);
    const before = store.usage.get(`${DEVICE_A}|${old}|claude|claude-opus-5`);

    // `sync --since 120` after the first sync: same transcripts, watermark now at DAY.
    const again = await applySync(store, device(DEVICE_A, DAY), payload(DEVICE_A, days), NOW);

    expect(again.days.map((row) => row.trustLevel)).toEqual(["verified", "reported", "verified"]);
    expect(again.days[1]?.reasons.map((reason) => reason.code)).toEqual(["no_receipt_stream"]);
    expect(store.usage.get(`${DEVICE_A}|${old}|claude|claude-opus-5`)).toBe(before);
    expect(store.builderDays.get(`${BUILDER}|${old}`)).toMatchObject({
      costUsd: 10,
      trustLevelMin: "reported",
    });
    expect(again.nextWatermark).toBe(DAY);
  });

  it("does not let a re-sent day past the backfill window change what was counted", async () => {
    const store = memoryStore();
    const old = "2026-08-01";
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day({ day: old })]), NOW);
    const again = await applySync(
      store,
      device(DEVICE_A, DAY),
      payload(DEVICE_A, [day({ day: old, costUsd: 500, outputTokens: 90_000 })]),
      NOW,
    );

    expect(again.days[0]?.trustLevel).toBe("verified");
    expect(store.usage.get(`${DEVICE_A}|${old}|claude|claude-opus-5`)?.costUsd).toBe(5);
    expect(store.builderDays.get(`${BUILDER}|${old}`)?.costUsd).toBe(5);
  });

  it("replaces corrected historical totals only when explicitly submitted for review", async () => {
    const store = memoryStore();
    const old = "2026-08-01";
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day({ day: old })]), NOW);
    const corrected = { ...payload(DEVICE_A, [day({ day: old, costUsd: 6 })]), reviewHistory: true as const };
    const result = await applySync(store, device(DEVICE_A, DAY), corrected, NOW);
    expect(result.days[0]).toMatchObject({ trustLevel: "quarantined" });
    expect(result.days[0]!.reasons.map((reason) => reason.code)).toContain("stale_backfill");
    expect(store.usage.get(`${DEVICE_A}|${old}|claude|claude-opus-5`)?.costUsd).toBe(6);
    expect(store.builderDays.get(`${BUILDER}|${old}`)?.trustLevelMin).toBe("quarantined");
    expect(result.nextWatermark).toBe(DAY);
  });

  it("does not mistake a new row past the backfill window for a stored one with a similar name", async () => {
    const store = memoryStore();
    const old = "2026-08-01";
    await applySync(
      store,
      device(DEVICE_A),
      payload(DEVICE_A, [day({ day: old, provider: "claude|opus", model: "5" })]),
      NOW,
    );
    const late = await applySync(
      store,
      device(DEVICE_A, DAY),
      payload(DEVICE_A, [day({ day: old, provider: "claude", model: "opus|5" })]),
      NOW,
    );

    expect(late.days[0]?.reasons.map((reason) => reason.code)).toContain("stale_backfill");
  });

  it("still quarantines a day that arrives for the first time past the backfill window", async () => {
    const store = memoryStore();
    const old = "2026-08-01";
    await applySync(store, device(DEVICE_A), payload(DEVICE_A, [day()]), NOW);
    const late = await applySync(
      store,
      device(DEVICE_A, DAY),
      payload(DEVICE_A, [day({ day: old }), day()]),
      NOW,
    );

    expect(late.days.map((row) => row.trustLevel)).toEqual(["quarantined", "verified"]);
    expect(late.days[0]?.reasons.map((reason) => reason.code)).toEqual(["stale_backfill"]);
    expect(store.builderDays.get(`${BUILDER}|${old}`)?.trustLevelMin).toBe("quarantined");
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
