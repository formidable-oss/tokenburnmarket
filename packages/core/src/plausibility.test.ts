import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAUSIBILITY_LIMITS,
  type UsageDayInput,
  checkPlausibility,
} from "./plausibility";

const NOW = new Date("2026-08-17T12:00:00.000Z");

/** An ordinary Claude Code day: heavy cache reads, modest output, receipts present. */
function ordinaryDay(overrides: Partial<UsageDayInput> = {}): UsageDayInput {
  return {
    day: "2026-08-16",
    provider: "anthropic",
    model: "claude-sonnet-4-5-20250929",
    inputTokens: 12_000,
    cachedInputTokens: 4_200_000,
    cacheWriteTokens: 180_000,
    outputTokens: 240_000,
    reasoningTokens: 0,
    costUsd: 42.5,
    receiptCount: 1_400,
    ...overrides,
  };
}

const codes = (row: UsageDayInput) => checkPlausibility(row, { now: NOW }).reasons.map((r) => r.code);

describe("checkPlausibility", () => {
  it("verifies an ordinary day with a Receipt Stream", () => {
    const result = checkPlausibility(ordinaryDay(), { now: NOW });
    expect(result.trustLevel).toBe("verified");
    expect(result.reasons).toEqual([]);
  });

  it("reports a day with no Receipt Stream and says why", () => {
    const result = checkPlausibility(ordinaryDay({ receiptCount: 0 }), { now: NOW });
    expect(result.trustLevel).toBe("reported");
    expect(result.reasons.map((r) => r.code)).toEqual(["no_receipt_stream"]);
  });

  // API loops and parallel agents make all of these real. None of them is impossible.
  it.each([
    ["a high output rate", { outputTokens: 500_000_000, cachedInputTokens: 900_000_000, receiptCount: 10_000 }],
    ["output far above input", { inputTokens: 100, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 100_000, receiptCount: 100 }],
    ["output with no input recorded", { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0 }],
    ["cache reads far above cache writes", { cacheWriteTokens: 100, cachedInputTokens: 100_000_000 }],
    ["a very expensive day", { costUsd: 50_000, cachedInputTokens: 30_000_000_000, outputTokens: 10_000_000, receiptCount: 1_000 }],
  ] as const)("counts %s in full", (_, change) => {
    const result = checkPlausibility(ordinaryDay(change), { now: NOW });
    expect(result).toEqual({ trustLevel: "verified", reasons: [] });
  });

  it("quarantines a day that has not started", () => {
    expect(codes(ordinaryDay({ day: "2026-09-01" }))).toContain("future_day");
    expect(codes(ordinaryDay({ day: "not-a-day" }))).toContain("future_day");
  });

  it("quarantines a cost no model's price can reach for these tokens", () => {
    const result = checkPlausibility(ordinaryDay({ costUsd: 9_000_000 }), { now: NOW });
    expect(result.trustLevel).toBe("quarantined");
    expect(result.reasons).toEqual([
      expect.objectContaining({ code: "cost_above_any_price", limit: 2000 }),
    ]);
    expect(codes(ordinaryDay({ inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, costUsd: 1 })))
      .toEqual(["cost_above_any_price"]);
    // The dearest real price, $600 per million output tokens, passes.
    expect(codes(ordinaryDay({ inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 1_000_000, costUsd: 600, receiptCount: 100 })))
      .toEqual([]);
  });

  it("quarantines negative counts", () => {
    expect(codes(ordinaryDay({ outputTokens: -1 }))).toEqual(["negative_counts"]);
    expect(codes(ordinaryDay({ costUsd: Number.NaN }))).toEqual(["negative_counts"]);
  });

  it("judges an old day like any other", () => {
    expect(checkPlausibility(ordinaryDay({ day: "2025-01-10" }), { now: NOW })).toEqual({
      trustLevel: "verified",
      reasons: [],
    });
  });

  it("reports, and does not quarantine, a Receipt Stream claiming more tokens than its messages can carry", () => {
    const result = checkPlausibility(ordinaryDay({ receiptCount: 1 }), { now: NOW });
    expect(result.trustLevel).toBe("reported");
    expect(result.reasons).toEqual([
      expect.objectContaining({ code: "receipt_stream_incoherent", observed: 240_000, limit: 200_000 }),
    ]);
  });

  it("reports, and does not quarantine, a Receipt Stream thinner than its tokens", () => {
    const result = checkPlausibility(ordinaryDay({ receiptCount: 5_000_000 }), { now: NOW });
    expect(result.trustLevel).toBe("reported");
    expect(result.reasons.map((r) => r.code)).toEqual(["receipt_stream_thin"]);
  });

  // The shape that prompted this split: a collector under-reported one model's
  // output tokens while the receipt walk still found every message.
  it("reports the collector-skew shape from issue #36 rather than voiding the day", () => {
    const result = checkPlausibility(
      ordinaryDay({ outputTokens: 4, reasoningTokens: 0, receiptCount: 682, costUsd: 0.83 }),
      { now: NOW },
    );
    expect(result.trustLevel).toBe("reported");
    expect(result.reasons.map((r) => r.code)).toEqual(["receipt_stream_thin"]);
  });

  it("accepts the exact minimum and includes reasoning tokens in receipt evidence", () => {
    const result = checkPlausibility(
      ordinaryDay({ outputTokens: 4, reasoningTokens: 678, receiptCount: 682 }),
      { now: NOW },
    );
    expect(result).toEqual({ trustLevel: "verified", reasons: [] });
  });

  it("uses the configured minimum for thin streams", () => {
    const result = checkPlausibility(
      ordinaryDay({ outputTokens: 1000, receiptCount: 1000 }),
      { now: NOW, limits: { minOutputTokensPerReceipt: 2 } },
    );
    expect(result.trustLevel).toBe("reported");
    expect(result.reasons).toEqual([
      expect.objectContaining({ code: "receipt_stream_thin", observed: 1, limit: 2 }),
    ]);
  });

  it("only ever returns one of the three Trust Levels, and explains every non-Verified verdict", () => {
    const nonNegative = fc.integer({ min: 0, max: 5_000_000_000 });
    fc.assert(
      fc.property(
        fc.record({
          day: fc.constantFrom("2026-08-14", "2026-08-16", "2026-08-17", "2027-01-01", "oops"),
          provider: fc.constantFrom("anthropic", "openai", "google", "zed"),
          model: fc.constantFrom("claude-sonnet-4-5", "claude-haiku-4-5", "gpt-5", "unknown"),
          inputTokens: nonNegative,
          cachedInputTokens: nonNegative,
          cacheWriteTokens: nonNegative,
          outputTokens: nonNegative,
          reasoningTokens: nonNegative,
          costUsd: fc.double({ min: 0, max: 100_000, noNaN: true }),
          receiptCount: nonNegative,
        }),
        (row) => {
          const result = checkPlausibility(row, { now: NOW });
          expect(["verified", "reported", "quarantined"]).toContain(result.trustLevel);
          if (result.trustLevel === "verified") {
            expect(result.reasons).toEqual([]);
          } else {
            expect(result.reasons.length).toBeGreaterThan(0);
          }
          // Only a day that has not started, or is not a day at all, or a cost
          // beyond any price for its tokens, is held back.
          const processed =
            row.inputTokens + row.cachedInputTokens + row.cacheWriteTokens + row.outputTokens + row.reasoningTokens;
          const impossible =
            row.day === "2027-01-01" || row.day === "oops" || row.costUsd > (processed / 1_000_000) * 2000;
          expect(result.trustLevel === "quarantined").toBe(impossible);
        },
      ),
    );
  });

  it("ships bounds that real usage stays inside", () => {
    expect(DEFAULT_PLAUSIBILITY_LIMITS).toEqual({
      maxCostUsdPerMillionTokens: 2000,
      maxOutputTokensPerReceipt: 200_000,
      minOutputTokensPerReceipt: 1,
    });
  });
});
