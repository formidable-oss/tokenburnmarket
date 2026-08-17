import { describe, expect, it } from "vitest";
import {
  MAX_OUTCOMES,
  formatClosesIn,
  formatPriceCents,
  formatProbability,
  marketRulesText,
  normalizeClosesAt,
  normalizeOutcomeLabels,
  normalizeQuestion,
  normalizeShareAmount,
  resolutionTimeFor,
} from "./markets";

const NOW = new Date("2026-08-17T12:00:00Z");

describe("normalizeQuestion", () => {
  it("collapses whitespace and keeps the words", () => {
    expect(normalizeQuestion("  Who   burns most  this week? ")).toEqual({
      ok: true,
      value: "Who burns most this week?",
    });
  });

  it("refuses nothing, a fragment, and a wall of text", () => {
    expect(normalizeQuestion("   ").ok).toBe(false);
    expect(normalizeQuestion("who?").ok).toBe(false);
    expect(normalizeQuestion("q".repeat(141)).ok).toBe(false);
  });
});

describe("normalizeOutcomeLabels", () => {
  it("drops the empty slots a half-filled form sends", () => {
    expect(normalizeOutcomeLabels(["@alex", "  ", "@theo", undefined, null])).toEqual({
      ok: true,
      value: ["@alex", "@theo"],
    });
  });

  it("needs two answers and takes at most eight", () => {
    expect(normalizeOutcomeLabels(["@alex", ""]).ok).toBe(false);
    expect(
      normalizeOutcomeLabels(Array.from({ length: MAX_OUTCOMES + 1 }, (_, i) => `o${i}`)).ok,
    ).toBe(false);
  });

  it("refuses two outcomes that say the same thing", () => {
    expect(normalizeOutcomeLabels(["@alex", "@Alex"]).ok).toBe(false);
  });

  it("refuses a label longer than the cap", () => {
    expect(normalizeOutcomeLabels(["@alex", "x".repeat(61)]).ok).toBe(false);
  });
});

describe("normalizeClosesAt", () => {
  it("reads a zoneless datetime-local value as UTC", () => {
    const result = normalizeClosesAt("2026-08-18T09:30", NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.toISOString()).toBe("2026-08-18T09:30:00.000Z");
  });

  it("keeps an explicit zone when one is given", () => {
    const result = normalizeClosesAt("2026-08-18T09:30:00+02:00", NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.toISOString()).toBe("2026-08-18T07:30:00.000Z");
  });

  it("refuses a close in the past, one too soon, and one too far out", () => {
    expect(normalizeClosesAt("2026-08-17T11:00", NOW).ok).toBe(false);
    expect(normalizeClosesAt("2026-08-17T12:05", NOW).ok).toBe(false);
    expect(normalizeClosesAt("2028-08-17T12:00", NOW).ok).toBe(false);
    expect(normalizeClosesAt("not a time", NOW).ok).toBe(false);
    expect(normalizeClosesAt("", NOW).ok).toBe(false);
  });
});

describe("resolutionTimeFor", () => {
  it("leaves a day for a late sync", () => {
    expect(resolutionTimeFor(NOW).toISOString()).toBe("2026-08-18T12:00:00.000Z");
  });
});

describe("normalizeShareAmount", () => {
  it("rounds to the four decimals a position can hold", () => {
    expect(normalizeShareAmount("10.00005")).toEqual({ ok: true, value: 10.0001 });
    expect(normalizeShareAmount(2.5)).toEqual({ ok: true, value: 2.5 });
  });

  it("refuses nothing, zero, negatives and absurd sizes", () => {
    expect(normalizeShareAmount("").ok).toBe(false);
    expect(normalizeShareAmount("abc").ok).toBe(false);
    expect(normalizeShareAmount(0).ok).toBe(false);
    expect(normalizeShareAmount(-5).ok).toBe(false);
    expect(normalizeShareAmount(100_001).ok).toBe(false);
  });
});

describe("formatting", () => {
  it("quotes prices in cents and probabilities in percent", () => {
    expect(formatPriceCents(0.4237)).toBe("42.4¢");
    expect(formatProbability(0.4237)).toBe("42%");
  });

  it("counts down at the coarsest useful precision", () => {
    expect(formatClosesIn(new Date("2026-08-20T12:00:00Z"), NOW)).toBe("closes in 3d");
    expect(formatClosesIn(new Date("2026-08-17T18:00:00Z"), NOW)).toBe("closes in 6h");
    expect(formatClosesIn(new Date("2026-08-17T12:20:00Z"), NOW)).toBe("closes in 20m");
    expect(formatClosesIn(new Date("2026-08-17T11:00:00Z"), NOW)).toBe("closed");
  });
});

describe("marketRulesText", () => {
  it("prefers the sentence written at creation", () => {
    expect(marketRulesText({ rules: "  Top burner takes it.  " }, NOW)).toBe("Top burner takes it.");
  });

  it("builds one from the period and the settlement time otherwise", () => {
    const text = marketRulesText({ periodStart: "2026-08-10", periodEnd: "2026-08-16" }, NOW);
    expect(text).toContain("2026-08-10 to 2026-08-16");
    expect(text).toContain("A winning share pays 1 credit.");
  });

  it("still says when it settles with no period at all", () => {
    expect(marketRulesText({}, NOW)).toContain("Settled from Usage at");
  });
});
