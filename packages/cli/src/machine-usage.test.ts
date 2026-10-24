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
  readOpenCode: async () => ({ details: new Map([[key, { ...row, reasoningTokens: 15, receipts: new Set([hash]) }]]), incompleteSources: [], incompleteSourceCount: 0 }),
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
      readOpenCode: async () => ({ details: new Map(), incompleteSources, incompleteSourceCount: incompleteSources.length }),
      readReceipts: () => new Map([[key, new Set([hash])]]), warn: (message) => warnings.push(message) });
    expect(usage.aggregates).toEqual([{ ...row, onlyIfMissing: true }, claude]);
    expect(usage.receipts.has(key)).toBe(false);
    const days = buildSyncDays(usage.aggregates, usage.receipts, { now: new Date("2026-10-23T00:00:00Z") });
    expect(days.find((day) => day.provider === "opencode")).toEqual({ ...row, onlyIfMissing: true, receipts: [] });
    expect(warnings.join(" ")).toContain("stored usage is preserved");
  });

  it("falls back to missing-only ccusage totals when usage changes during collection", async () => {
    const warnings: string[] = [];
    const usage = await readMachineUsage({ ...defaults, warn: (message) => warnings.push(message),
      readReceipts: () => new Map([[key, new Set([hash])]]),
      readOpenCode: async () => ({ details: new Map([[key, { ...row, outputTokens: 30, reasoningTokens: 15, receipts: new Set([hash]) }]]), incompleteSources: [], incompleteSourceCount: 0 }),
    });
    expect(usage.aggregates).toEqual([{ ...row, onlyIfMissing: true }]);
    expect(usage.receipts.size).toBe(0);
    expect(warnings).toEqual([expect.stringContaining("changed during the scan")]);
  });

  it("keeps details for unaffected days and warns once for every fallback row", async () => {
    const warnings: string[] = [];
    const older = Array.from({ length: 30 }, (_, i) => ({ ...row, day: `2026-09-${String(i + 1).padStart(2, "0")}` }));
    const sources = Array.from({ length: 10 }, (_, i) => `/local/storage/message/s/m${i}.json`);
    const usage = await readMachineUsage({ ...defaults, warn: (message) => warnings.push(message),
      readBase: async () => [...older, row],
      readOpenCode: async () => ({ details: new Map([[key, { ...row, reasoningTokens: 15, receipts: new Set([hash]) }]]),
        incompleteSources: sources, incompleteSourceCount: 12 }),
    });
    expect(usage.aggregates.filter((day) => day.onlyIfMissing)).toHaveLength(30);
    expect(usage.aggregates.at(-1)).toEqual({ ...row, reasoningTokens: 15 });
    expect(usage.receipts.get(key)).toEqual(new Set([hash]));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("30 days from 2026-09-01 to 2026-09-30");
    expect(warnings[0]).toContain(`${JSON.stringify(sources[9])} and 2 more`);
    expect(warnings[0]).not.toContain("changed during the scan");
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
