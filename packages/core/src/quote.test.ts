import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLIPPAGE_TOLERANCE,
  lmsrAdverseMove,
  lmsrCostToBuy,
  lmsrPrice,
  lmsrProceedsOfSell,
  lmsrQuote,
} from "./lmsr";

const liquidity = fc.double({ min: 5, max: 500, noNaN: true, noDefaultInfinity: true });
const holding = fc.double({ min: 0, max: 2000, noNaN: true, noDefaultInfinity: true });
const book = fc
  .record({
    shares: fc.array(holding, { minLength: 2, maxLength: 8 }),
    b: liquidity,
  })
  .chain(({ shares, b }) =>
    fc.record({
      shares: fc.constant(shares),
      b: fc.constant(b),
      outcome: fc.integer({ min: 0, max: shares.length - 1 }),
      amount: fc.double({ min: 0, max: 500, noNaN: true, noDefaultInfinity: true }),
    }),
  );

describe("lmsrQuote", () => {
  it("charges exactly what the cost function charges", () => {
    fc.assert(
      fc.property(book, ({ shares, b, outcome, amount }) => {
        const quote = lmsrQuote(shares, b, outcome, "buy", amount);
        expect(quote.credits).toBe(lmsrCostToBuy(shares, b, outcome, amount));
        expect(quote.sharesAfter[outcome]).toBe(shares[outcome] + amount);
      }),
    );
  });

  it("pays exactly what the cost function pays", () => {
    fc.assert(
      fc.property(book, ({ shares, b, outcome, amount }) => {
        const size = Math.min(amount, shares[outcome]);
        const quote = lmsrQuote(shares, b, outcome, "sell", size);
        expect(quote.credits).toBe(lmsrProceedsOfSell(shares, b, outcome, size));
        expect(quote.sharesAfter[outcome]).toBeCloseTo(shares[outcome] - size, 9);
      }),
    );
  });

  it("reports the price before and after the trade", () => {
    const quote = lmsrQuote([0, 0], 50, 0, "buy", 25);
    expect(quote.priceBefore).toBeCloseTo(0.5, 10);
    expect(quote.priceAfter).toBeCloseTo(lmsrPrice([25, 0], 50, 0), 12);
    expect(quote.priceAfter).toBeGreaterThan(quote.priceBefore);
  });

  it("prices a sell below the price before it and a buy above", () => {
    fc.assert(
      fc.property(book, ({ shares, b, outcome, amount }) => {
        fc.pre(amount > 0.01);
        const buy = lmsrQuote(shares, b, outcome, "buy", amount);
        // Rounding up a tiny trade can nudge the average above the after-price.
        expect(buy.averagePrice).toBeGreaterThanOrEqual(buy.priceBefore - 1e-9);

        const size = Math.min(amount, shares[outcome]);
        if (size > 0.01) {
          const sell = lmsrQuote(shares, b, outcome, "sell", size);
          expect(sell.averagePrice).toBeLessThanOrEqual(sell.priceBefore + 1e-9);
        }
      }),
    );
  });

  it("never lets a buy and an immediate sell profit", () => {
    fc.assert(
      fc.property(book, ({ shares, b, outcome, amount }) => {
        const buy = lmsrQuote(shares, b, outcome, "buy", amount);
        const sell = lmsrQuote(buy.sharesAfter, b, outcome, "sell", amount);
        expect(sell.credits).toBeLessThanOrEqual(buy.credits);
      }),
    );
  });

  it("quotes nothing for a zero-share trade", () => {
    const quote = lmsrQuote([10, 5], 40, 1, "buy", 0);
    expect(quote.credits).toBe(0);
    expect(quote.averagePrice).toBe(0);
    expect(quote.priceAfter).toBe(quote.priceBefore);
  });

  it("refuses to sell shares that are not outstanding", () => {
    expect(() => lmsrQuote([3, 0], 40, 0, "sell", 4)).toThrow(RangeError);
    expect(() => lmsrQuote([3, 0], 40, 1, "sell", 1)).toThrow(RangeError);
  });

  it("refuses a negative amount and an outcome that does not exist", () => {
    expect(() => lmsrQuote([1, 1], 40, 0, "buy", -1)).toThrow(RangeError);
    expect(() => lmsrQuote([1, 1], 40, 2, "buy", 1)).toThrow(RangeError);
  });
});

describe("lmsrAdverseMove", () => {
  it("is positive when a buy costs more than previewed", () => {
    expect(lmsrAdverseMove("buy", 0.4, 0.404)).toBeCloseTo(0.01, 12);
    expect(lmsrAdverseMove("buy", 0.4, 0.396)).toBeCloseTo(-0.01, 12);
  });

  it("is positive when a sell pays less than previewed", () => {
    expect(lmsrAdverseMove("sell", 0.4, 0.396)).toBeCloseTo(0.01, 12);
    expect(lmsrAdverseMove("sell", 0.4, 0.404)).toBeCloseTo(-0.01, 12);
  });

  it("reports no move when nothing was previewed", () => {
    expect(lmsrAdverseMove("buy", 0, 0.9)).toBe(0);
    expect(lmsrAdverseMove("sell", Number.NaN, 0.9)).toBe(0);
  });

  it("keeps the tolerance at one percent", () => {
    expect(DEFAULT_SLIPPAGE_TOLERANCE).toBe(0.01);
  });
});
