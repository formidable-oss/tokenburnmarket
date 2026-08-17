import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAUSIBILITY_LIMITS,
  type PlausibilityContext,
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

const codes = (row: UsageDayInput, context: PlausibilityContext = { now: NOW }) =>
  checkPlausibility(row, context).reasons.map((r) => r.code);

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

  it("quarantines an impossible output rate", () => {
    const row = ordinaryDay({ outputTokens: 500_000_000, cachedInputTokens: 900_000_000 });
    expect(codes(row)).toContain("output_rate_ceiling");
    expect(checkPlausibility(row, { now: NOW }).trustLevel).toBe("quarantined");
  });

  it("quarantines output that dwarfs the input behind it", () => {
    const row = ordinaryDay({
      inputTokens: 100,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 100_000,
    });
    expect(codes(row)).toContain("output_input_ratio");
  });

  it("quarantines output with no input at all", () => {
    const row = ordinaryDay({ inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0 });
    expect(codes(row)).toContain("output_input_ratio");
  });

  it("quarantines cache reads out of proportion with cache writes", () => {
    const row = ordinaryDay({ cacheWriteTokens: 100, cachedInputTokens: 100_000_000 });
    expect(codes(row)).toContain("cache_ratio");
  });

  it("quarantines a daily cost above any known plan tier", () => {
    expect(codes(ordinaryDay({ costUsd: 50_000 }))).toContain("daily_cost_ceiling");
  });

  it("quarantines a day that has not started", () => {
    expect(codes(ordinaryDay({ day: "2026-09-01" }))).toContain("future_day");
    expect(codes(ordinaryDay({ day: "not-a-day" }))).toContain("future_day");
  });

  it("quarantines negative counts", () => {
    expect(codes(ordinaryDay({ outputTokens: -1 }))).toEqual(["negative_counts"]);
    expect(codes(ordinaryDay({ costUsd: Number.NaN }))).toEqual(["negative_counts"]);
  });

  it("keeps the Device watermark monotone outside the backfill window", () => {
    const row = ordinaryDay({ day: "2026-08-10" });
    expect(codes(row, { now: NOW })).toEqual([]);
    expect(
      checkPlausibility(row, { now: NOW, deviceWatermarkDay: "2026-08-11" }).reasons.map(
        (r) => r.code,
      ),
    ).toEqual([]);
    expect(
      checkPlausibility(row, { now: NOW, deviceWatermarkDay: "2026-08-16" }).reasons.map(
        (r) => r.code,
      ),
    ).toContain("stale_backfill");
  });

  it("quarantines a Receipt Stream that cannot account for the tokens", () => {
    expect(codes(ordinaryDay({ receiptCount: 1 }))).toContain("receipt_stream_incoherent");
    expect(codes(ordinaryDay({ receiptCount: 5_000_000 }))).toContain("receipt_stream_incoherent");
  });

  it("takes ceilings from the caller", () => {
    const row = ordinaryDay({ costUsd: 500 });
    expect(codes(row)).toEqual([]);
    expect(codes(row, { now: NOW, limits: { maxDailyCostUsdByProvider: { anthropic: 100 } } })).toContain(
      "daily_cost_ceiling",
    );
  });

  it("matches a model ceiling by prefix", () => {
    const row = ordinaryDay({ model: "claude-haiku-4-5-20251001", outputTokens: 100_000_000 });
    // The haiku prefix raises the rate ceiling, so this only trips the ratio checks.
    expect(codes(row)).not.toContain("output_rate_ceiling");
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
        },
      ),
    );
  });

  it("ships loose defaults so a real day is never quarantined by accident", () => {
    expect(DEFAULT_PLAUSIBILITY_LIMITS.backfillWindowDays).toBe(2);
    expect(checkPlausibility(ordinaryDay({ costUsd: 300 }), { now: NOW }).trustLevel).toBe(
      "verified",
    );
  });
});
