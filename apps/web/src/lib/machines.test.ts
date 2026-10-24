import { MAX_RECEIPTS_PER_DAY } from "@tokenburnmarket/core";
import { describe, expect, it } from "vitest";
import { supersedes, type UsageFigures } from "./machines";

function figures(overrides: Partial<UsageFigures> = {}): UsageFigures {
  return {
    inputTokens: 1000,
    cachedInputTokens: 100_000,
    cacheWriteTokens: 10_000,
    outputTokens: 2000,
    reasoningTokens: 0,
    costUsd: 5,
    receiptCount: 10,
    ...overrides,
  };
}

describe("supersedes", () => {
  it("lets a reading with at least as many tokens replace the stored one", () => {
    expect(supersedes(figures(), figures())).toBe(true);
    expect(supersedes(figures({ outputTokens: 3000, receiptCount: 0 }), figures())).toBe(true);
  });

  it("lets a lower reading replace it when the machine still has every message", () => {
    expect(supersedes(figures({ cachedInputTokens: 80_000, costUsd: 4 }), figures())).toBe(true);
  });

  it("keeps the stored reading when the lower one has fewer receipts or none to compare", () => {
    expect(supersedes(figures({ cachedInputTokens: 80_000, receiptCount: 9 }), figures())).toBe(false);
    expect(
      supersedes(figures({ cachedInputTokens: 80_000, receiptCount: 10 }), figures({ receiptCount: 0 })),
    ).toBe(false);
  });

  it("does not read a stream cut at the per-day cap as evidence", () => {
    const capped = figures({ receiptCount: MAX_RECEIPTS_PER_DAY });
    expect(supersedes(figures({ cachedInputTokens: 80_000, receiptCount: MAX_RECEIPTS_PER_DAY }), capped)).toBe(false);
  });

  it("does not take a drop to under half as a correction", () => {
    expect(supersedes(figures({ cachedInputTokens: 40_000 }), figures())).toBe(false);
  });
});
