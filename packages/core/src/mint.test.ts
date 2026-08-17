import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  MINT_CURVE_VERSION,
  MINT_KINK_USD,
  REPORTED_MINT_MULTIPLIER,
  mintCurve,
  mintForDay,
} from "./mint.js";

const cost = fc.double({ min: 0, max: 100_000, noNaN: true, noDefaultInfinity: true });

describe("mintCurve", () => {
  it("is linear at one Credit per dollar up to the kink", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: MINT_KINK_USD, noNaN: true }), (c) => {
        expect(mintCurve(c)).toBeCloseTo(c, 10);
      }),
    );
  });

  it("matches the ADR 0004 formula", () => {
    expect(mintCurve(0)).toBe(0);
    expect(mintCurve(20)).toBe(20);
    expect(mintCurve(45)).toBeCloseTo(20 + 2 * Math.sqrt(25), 10); // 30
    expect(mintCurve(420)).toBeCloseTo(20 + 2 * Math.sqrt(400), 10); // 60
  });

  it("never rewards more than 4x for 20x the spend", () => {
    // The product promise behind the curve: whales earn more, not proportionally more.
    expect(mintCurve(400) / mintCurve(20)).toBeLessThan(4);
  });

  it("clamps negative and non-finite cost to zero", () => {
    expect(mintCurve(-1)).toBe(0);
    expect(mintCurve(Number.NaN)).toBe(0);
    expect(mintCurve(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("is monotone non-decreasing", () => {
    fc.assert(
      fc.property(cost, cost, (a, b) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        expect(mintCurve(high)).toBeGreaterThanOrEqual(mintCurve(low));
      }),
    );
  });

  it("is concave above the kink", () => {
    // Concavity as the midpoint test: f((x+y)/2) >= (f(x)+f(y))/2.
    const above = fc.double({ min: MINT_KINK_USD, max: 100_000, noNaN: true });
    fc.assert(
      fc.property(above, above, (a, b) => {
        const mid = mintCurve((a + b) / 2);
        const chord = (mintCurve(a) + mintCurve(b)) / 2;
        // Tolerance absorbs float noise for pairs that straddle the kink by ~1e-15.
        expect(mid).toBeGreaterThanOrEqual(chord - 1e-6);
      }),
    );
  });

  it("has a slope that never grows", () => {
    const step = 0.5;
    fc.assert(
      fc.property(fc.double({ min: 0, max: 50_000, noNaN: true }), (c) => {
        const early = mintCurve(c + step) - mintCurve(c);
        const later = mintCurve(c + 2 * step) - mintCurve(c + step);
        expect(later).toBeLessThanOrEqual(early + 1e-6);
      }),
    );
  });
});

describe("mintForDay", () => {
  it("mints Reported Usage at 50 percent of Verified", () => {
    fc.assert(
      fc.property(cost, (c) => {
        const verified = mintForDay(c, "verified").credits;
        const reported = mintForDay(c, "reported").credits;
        expect(reported).toBeCloseTo(verified * REPORTED_MINT_MULTIPLIER, 3);
      }),
    );
  });

  it("mints nothing for Quarantined Usage", () => {
    fc.assert(
      fc.property(cost, (c) => {
        expect(mintForDay(c, "quarantined").credits).toBe(0);
      }),
    );
  });

  it("stamps the curve version so a later change stays auditable", () => {
    expect(mintForDay(30, "verified").curveVersion).toBe(MINT_CURVE_VERSION);
  });
});
