import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  lmsrCost,
  lmsrCostToBuy,
  lmsrHouseProfit,
  lmsrLiquidityForMembers,
  lmsrMaxHouseLoss,
  lmsrPrice,
  lmsrPrices,
  lmsrProceedsOfSell,
} from "./lmsr";

const liquidity = fc.double({ min: 5, max: 500, noNaN: true, noDefaultInfinity: true });
const share = fc.double({ min: -2000, max: 2000, noNaN: true, noDefaultInfinity: true });
const market = fc.record({
  shares: fc.array(share, { minLength: 2, maxLength: 8 }),
  b: liquidity,
});

function outcomeOf(shares: readonly number[]) {
  return fc.integer({ min: 0, max: shares.length - 1 });
}

describe("lmsrPrices", () => {
  it("returns a probability distribution", () => {
    fc.assert(
      fc.property(market, ({ shares, b }) => {
        const prices = lmsrPrices(shares, b);
        expect(prices).toHaveLength(shares.length);
        for (const p of prices) {
          // A wildly skewed book saturates at 0 or 1 in double precision.
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThanOrEqual(1);
        }
        expect(prices.reduce((a, p) => a + p, 0)).toBeCloseTo(1, 10);
      }),
    );
  });

  it("prices an untouched Market uniformly", () => {
    expect(lmsrPrices([0, 0, 0, 0], 50)).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  it("keeps every price strictly inside 0 and 1 for a realistic book", () => {
    for (const p of lmsrPrices([400, 120, 0], 80)) {
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(1);
    }
  });

  it("moves the bought Outcome up and the others down", () => {
    fc.assert(
      fc.property(
        market.chain(({ shares, b }) =>
          fc.record({
            shares: fc.constant(shares),
            b: fc.constant(b),
            outcome: outcomeOf(shares),
            amount: fc.double({ min: 1, max: 500, noNaN: true }),
          }),
        ),
        ({ shares, b, outcome, amount }) => {
          const after = shares.slice();
          after[outcome] += amount;
          expect(lmsrPrice(after, b, outcome)).toBeGreaterThanOrEqual(lmsrPrice(shares, b, outcome));
          for (let i = 0; i < shares.length; i += 1) {
            if (i === outcome) continue;
            expect(lmsrPrice(after, b, i)).toBeLessThanOrEqual(lmsrPrice(shares, b, i));
          }
        },
      ),
    );
  });

  it("stays finite for share counts that would overflow a naive exp", () => {
    const prices = lmsrPrices([1e6, 0], 10);
    expect(prices[0]).toBeCloseTo(1, 10);
    expect(Number.isFinite(lmsrCost([1e6, 0], 10))).toBe(true);
  });
});

describe("lmsrCostToBuy and lmsrProceedsOfSell", () => {
  const trade = market.chain(({ shares, b }) =>
    fc.record({
      shares: fc.constant(shares),
      b: fc.constant(b),
      outcome: outcomeOf(shares),
      amount: fc.double({ min: 0, max: 1000, noNaN: true }),
    }),
  );

  it("buying then immediately selling never profits", () => {
    fc.assert(
      fc.property(trade, ({ shares, b, outcome, amount }) => {
        const cost = lmsrCostToBuy(shares, b, outcome, amount);
        const after = shares.slice();
        after[outcome] += amount;
        const proceeds = lmsrProceedsOfSell(after, b, outcome, amount);
        expect(proceeds).toBeLessThanOrEqual(cost);
      }),
    );
  });

  it("charges between the current price and 1 Credit per share", () => {
    fc.assert(
      fc.property(trade, ({ shares, b, outcome, amount }) => {
        const cost = lmsrCostToBuy(shares, b, outcome, amount);
        // Rounding up to Credit precision can add at most one tick.
        const tick = 1e-4;
        expect(cost).toBeGreaterThanOrEqual(lmsrPrice(shares, b, outcome) * amount - tick);
        expect(cost).toBeLessThanOrEqual(amount + tick);
      }),
    );
  });

  it("costs nothing to trade nothing", () => {
    expect(lmsrCostToBuy([0, 0], 50, 0, 0)).toBe(0);
    expect(lmsrProceedsOfSell([0, 0], 50, 0, 0)).toBe(0);
  });

  it("rejects malformed Markets and trades", () => {
    expect(() => lmsrCostToBuy([0], 50, 0, 1)).toThrow(RangeError);
    expect(() => lmsrCostToBuy([0, 0], 0, 0, 1)).toThrow(RangeError);
    expect(() => lmsrCostToBuy([0, 0], 50, 2, 1)).toThrow(RangeError);
    expect(() => lmsrCostToBuy([0, 0], 50, 0, -1)).toThrow(RangeError);
  });
});

describe("house loss", () => {
  it("is bounded by b times ln(n) whatever the traders do", () => {
    const session = fc
      .record({
        outcomeCount: fc.integer({ min: 2, max: 8 }),
        b: liquidity,
      })
      .chain(({ outcomeCount, b }) =>
        fc.record({
          outcomeCount: fc.constant(outcomeCount),
          b: fc.constant(b),
          trades: fc.array(
            fc.record({
              outcome: fc.integer({ min: 0, max: outcomeCount - 1 }),
              amount: fc.double({ min: 0, max: 800, noNaN: true }),
              sell: fc.boolean(),
            }),
            { maxLength: 30 },
          ),
        }),
      );

    fc.assert(
      fc.property(session, ({ outcomeCount, b, trades }) => {
        const shares = new Array<number>(outcomeCount).fill(0);
        let houseCredits = 0;
        for (const t of trades) {
          if (t.sell) {
            // Nobody can sell shares they do not hold, so the book never goes short.
            const amount = Math.min(t.amount, shares[t.outcome]);
            houseCredits -= lmsrProceedsOfSell(shares, b, t.outcome, amount);
            shares[t.outcome] -= amount;
          } else {
            houseCredits += lmsrCostToBuy(shares, b, t.outcome, t.amount);
            shares[t.outcome] += t.amount;
          }
        }
        const bound = lmsrMaxHouseLoss(b, outcomeCount);
        for (let winner = 0; winner < outcomeCount; winner += 1) {
          expect(houseCredits - shares[winner]).toBeGreaterThanOrEqual(-bound - 1e-6);
        }
      }),
    );
  });

  it("agrees with the closed-form profit for any reachable book", () => {
    fc.assert(
      fc.property(
        market.chain(({ shares, b }) =>
          fc.record({
            shares: fc.constant(shares.map((q) => Math.max(0, q))),
            b: fc.constant(b),
            winner: outcomeOf(shares),
          }),
        ),
        ({ shares, b, winner }) => {
          const profit = lmsrHouseProfit(shares, b, winner);
          expect(profit).toBeGreaterThanOrEqual(-lmsrMaxHouseLoss(b, shares.length) - 1e-9);
        },
      ),
    );
  });

  it("costs the full bound when one Outcome is bought to certainty", () => {
    const b = 100;
    const shares = [0, 0, 0];
    const profit = lmsrHouseProfit([100_000, 0, 0], b, 0);
    expect(profit).toBeCloseTo(-lmsrMaxHouseLoss(b, shares.length), 6);
  });
});

describe("lmsrLiquidityForMembers", () => {
  it("follows ADR 0002: b = 20 + 5 * members", () => {
    expect(lmsrLiquidityForMembers(0)).toBe(20);
    expect(lmsrLiquidityForMembers(12)).toBe(80);
    expect(lmsrLiquidityForMembers(-3)).toBe(20);
  });
});
