import { describe, expect, it } from "vitest";
import {
  dayRange,
  parseUsageWindow,
  summarizeUsage,
  summarizeUsageHistory,
  type UsageRow,
} from "./usage";

const row = (overrides: Partial<UsageRow> = {}): UsageRow => ({
  day: "2026-08-16",
  provider: "claude",
  model: "claude-opus-5",
  costUsd: 2.5,
  inputTokens: 100,
  cachedInputTokens: 900,
  cacheWriteTokens: 0,
  outputTokens: 40,
  reasoningTokens: 0,
  trustLevel: "verified",
  ...overrides,
});

describe("dayRange", () => {
  it("ends on the day of the given instant and runs oldest first", () => {
    expect(dayRange(new Date("2026-08-17T23:00:00.000Z"), 3)).toEqual([
      "2026-08-15",
      "2026-08-16",
      "2026-08-17",
    ]);
  });
});

describe("parseUsageWindow", () => {
  it("accepts 90 days and defaults every other query to 30", () => {
    expect(parseUsageWindow("90")).toBe(90);
    expect(parseUsageWindow("30")).toBe(30);
    expect(parseUsageWindow("all")).toBe(30);
    expect(parseUsageWindow(["90"])).toBe(30);
    expect(parseUsageWindow(undefined)).toBe(30);
  });
});

describe("summarizeUsage", () => {
  const days = dayRange(new Date("2026-08-17T12:00:00.000Z"), 3);

  it("fills days with no usage so the sparkline keeps its shape", () => {
    const summary = summarizeUsage([row()], days);
    expect(summary.days).toEqual([
      { day: "2026-08-15", costUsd: 0, tokens: 0 },
      { day: "2026-08-16", costUsd: 2.5, tokens: 1040 },
      { day: "2026-08-17", costUsd: 0, tokens: 0 },
    ]);
  });

  it("combines cost and tokens into each daily chart point", () => {
    const summary = summarizeUsage(
      [
        row({ costUsd: 1.25 }),
        row({ provider: "codex", model: "gpt-5.6-sol", costUsd: 3.5 }),
      ],
      days,
    );

    expect(summary.days[1]).toEqual({ day: "2026-08-16", costUsd: 4.75, tokens: 2080 });
  });

  it("totals by provider and by model, heaviest first", () => {
    const summary = summarizeUsage(
      [
        row(),
        row({ model: "claude-haiku-4-5", costUsd: 0.25 }),
        row({ provider: "codex", model: "gpt-5.6-sol", costUsd: 4, trustLevel: "reported" }),
      ],
      days,
    );

    expect(summary.byProvider).toEqual([
      { provider: "codex", model: "", costUsd: 4, tokens: 1040, trustLevel: "reported" },
      { provider: "claude", model: "", costUsd: 2.75, tokens: 2080, trustLevel: "verified" },
    ]);
    expect(summary.byModel.map((group) => group.model)).toEqual([
      "gpt-5.6-sol",
      "claude-opus-5",
      "claude-haiku-4-5",
    ]);
    expect(summary.totalCostUsd).toBe(6.75);
  });

  it("keeps quarantined rows apart from every total", () => {
    const summary = summarizeUsage([row(), row({ costUsd: 900, trustLevel: "quarantined" })], days);

    expect(summary.totalCostUsd).toBe(2.5);
    expect(summary.byProvider).toHaveLength(1);
    expect(summary.quarantined).toHaveLength(1);
  });
});

describe("summarizeUsageHistory", () => {
  it("builds all-time totals and monthly history from active days", () => {
    expect(
      summarizeUsageHistory([
        { day: "2026-06-30", costUsd: 1.25, totalTokens: 100 },
        { day: "2026-07-02", costUsd: 2, totalTokens: 200 },
        { day: "2026-07-01", costUsd: 3.5, totalTokens: 300 },
        { day: "2026-08-01", costUsd: 0, totalTokens: 0 },
      ]),
    ).toEqual({
      months: [
        { month: "2026-06", costUsd: 1.25, tokens: 100 },
        { month: "2026-07", costUsd: 5.5, tokens: 500 },
      ],
      totalCostUsd: 6.75,
      totalTokens: 600,
      activeDays: 3,
      firstDay: "2026-06-30",
    });
  });
});
