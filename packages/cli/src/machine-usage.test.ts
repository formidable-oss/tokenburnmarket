import { describe, expect, it } from "vitest";
import { buildSyncDays } from "./collect.js";
import { readMachineUsage, type MachineUsageOptions } from "./machine-usage.js";
import { receiptKey } from "./receipts.js";
import type { UsageAggregate } from "./ccusage.js";

const row: UsageAggregate = {
  day: "2026-10-21", provider: "opencode", model: "gpt-5", inputTokens: 100,
  cachedInputTokens: 60, cacheWriteTokens: 10, outputTokens: 20, reasoningTokens: 0, costUsd: 0.05,
};
const key = receiptKey(row.day, row.provider, row.model);
const hash = "a".repeat(64);
const defaults: MachineUsageOptions = {
  home: "/nonexistent", env: {},
  readBase: async () => [row],
  readReceipts: () => new Map(),
  readOpenCode: async () => ({ details: new Map([[key, { ...row, reasoningTokens: 15, receipts: new Set([hash]) }]]), incompleteSources: [] }),
  readCursor: async () => ({ aggregates: [], receipts: new Map() }),
};

describe("readMachineUsage", () => {
  it("restores per-model OpenCode reasoning without changing cost", async () => {
    const usage = await readMachineUsage(defaults);
    const days = buildSyncDays(usage.aggregates, usage.receipts, { now: new Date("2026-10-23T00:00:00Z") });
    expect(days).toEqual([{ ...row, reasoningTokens: 15, receipts: [hash] }]);
    expect(days[0]!.inputTokens + days[0]!.cachedInputTokens + days[0]!.cacheWriteTokens +
      days[0]!.outputTokens + days[0]!.reasoningTokens).toBe(205);
  });

  it("does not add single-model reasoning a second time", async () => {
    const usage = await readMachineUsage({ ...defaults, readBase: async () => [{ ...row, reasoningTokens: 15 }] });
    expect(usage.aggregates[0]!.reasoningTokens).toBe(15);
  });

  it.each([{ incompleteSources: [] }, { incompleteSources: ["/local/broken.db"] }])("submits missing OpenCode rows when supplemental sources fail: %j", async ({ incompleteSources }) => {
    const warnings: string[] = [];
    const claude = { ...row, provider: "claude" };
    const usage = await readMachineUsage({ ...defaults, readBase: async () => [row, claude],
      readOpenCode: async () => ({ details: new Map(), incompleteSources }),
      readReceipts: () => new Map([[key, new Set([hash])]]), warn: (message) => warnings.push(message) });
    expect(usage.aggregates).toEqual([{ ...row, onlyIfMissing: true }, claude]);
    expect(usage.receipts.has(key)).toBe(false);
    const days = buildSyncDays(usage.aggregates, usage.receipts, { now: new Date("2026-10-23T00:00:00Z") });
    expect(days.find((day) => day.provider === "opencode")).toEqual({ ...row, onlyIfMissing: true, receipts: [] });
    expect(warnings.join(" ")).toContain("stored usage is preserved");
  });

  it("waits for matching snapshots when usage changes during collection", async () => {
    const usage = await readMachineUsage({ ...defaults,
      readOpenCode: async () => ({ details: new Map([[key, { ...row, outputTokens: 30, reasoningTokens: 15, receipts: new Set([hash]) }]]), incompleteSources: [] }),
    });
    expect(usage.aggregates).toEqual([]);
    expect(usage.receipts.size).toBe(0);
  });

  it("adds Cursor account usage and its receipts to the sync payload", async () => {
    const cursor = { ...row, provider: "cursor" };
    const cursorKey = receiptKey(cursor.day, cursor.provider, cursor.model);
    const usage = await readMachineUsage({ ...defaults,
      readCursor: async () => ({ aggregates: [cursor], receipts: new Map([[cursorKey, new Set([hash])]]) }),
    });
    const days = buildSyncDays(usage.aggregates, usage.receipts, { now: new Date("2026-10-23T00:00:00Z") });
    expect(days.find((day) => day.provider === "cursor")).toEqual({ ...cursor, receipts: [hash] });
    expect(days).toHaveLength(2);
  });
});
