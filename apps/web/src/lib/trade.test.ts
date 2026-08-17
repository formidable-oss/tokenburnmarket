import { lmsrQuote, roundCredits } from "@tokenburnmarket/core";
import { describe, expect, it } from "vitest";
import { planTrade, type TradeBook, type TradeRequest, type TraderState } from "./trade";

const NOW = new Date("2026-08-17T12:00:00Z");

function book(sharesOutstanding: number[] = [0, 0], overrides: Partial<TradeBook> = {}): TradeBook {
  return {
    status: "open",
    closesAt: new Date("2026-08-24T00:00:00Z"),
    b: 50,
    outcomeIds: sharesOutstanding.map((_, index) => `o${index}`),
    sharesOutstanding,
    ...overrides,
  };
}

function trader(overrides: Partial<TraderState> = {}): TraderState {
  return { balance: 1000, positionShares: 0, positionCostBasis: 0, ...overrides };
}

function request(overrides: Partial<TradeRequest> = {}): TradeRequest {
  return {
    outcomeId: "o0",
    side: "buy",
    shares: 10,
    previewAveragePrice: 0,
    acceptSlippage: false,
    ...overrides,
  };
}

describe("planTrade pricing", () => {
  it("charges exactly what the shared core function quotes", () => {
    const market = book([12, 4]);
    const plan = planTrade(market, trader(), request({ shares: 25 }), NOW);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    // The browser previews with the same call and the same arguments.
    const preview = lmsrQuote(market.sharesOutstanding, market.b, 0, "buy", 25);
    expect(plan.quote.credits).toBe(preview.credits);
    expect(plan.quote.averagePrice).toBe(preview.averagePrice);
    expect(plan.quote.priceAfter).toBe(preview.priceAfter);
    expect(plan.delta).toBe(-preview.credits);
    expect(plan.outcomeSharesAfter).toBe(37);
  });

  it("returns AMM proceeds on a sell and moves the price down", () => {
    const market = book([40, 0]);
    const plan = planTrade(
      market,
      trader({ positionShares: 40, positionCostBasis: 24 }),
      request({ side: "sell", shares: 40 }),
      NOW,
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.quote.credits).toBe(lmsrQuote([40, 0], 50, 0, "sell", 40).credits);
    expect(plan.delta).toBeGreaterThan(0);
    expect(plan.quote.priceAfter).toBeLessThan(plan.quote.priceBefore);
    expect(plan.outcomeSharesAfter).toBe(0);
  });

  it("takes cost basis out in proportion to the shares sold", () => {
    const plan = planTrade(
      book([40, 0]),
      trader({ positionShares: 40, positionCostBasis: 24 }),
      request({ side: "sell", shares: 10 }),
      NOW,
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.positionSharesAfter).toBe(30);
    expect(plan.positionCostBasisAfter).toBe(18);
  });

  it("zeroes cost basis when the position is sold out", () => {
    const plan = planTrade(
      book([7.3333, 0]),
      trader({ positionShares: 7.3333, positionCostBasis: 4.1111 }),
      request({ side: "sell", shares: 7.3333 }),
      NOW,
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.positionSharesAfter).toBe(0);
    expect(plan.positionCostBasisAfter).toBe(0);
  });
});

describe("planTrade refusals", () => {
  it("refuses a market that is not open", () => {
    for (const status of ["closed", "resolved", "voided"] as const) {
      expect(planTrade(book([0, 0], { status }), trader(), request(), NOW)).toMatchObject({
        ok: false,
        code: "market_closed",
      });
    }
  });

  it("refuses a market that is open but past its close", () => {
    const past = book([0, 0], { closesAt: new Date("2026-08-17T11:59:00Z") });
    expect(planTrade(past, trader(), request(), NOW)).toMatchObject({ code: "market_closed" });
  });

  it("refuses an outcome that is not in the book", () => {
    expect(planTrade(book(), trader(), request({ outcomeId: "nope" }), NOW)).toMatchObject({
      code: "unknown_outcome",
    });
  });

  it("refuses a buy the balance cannot cover", () => {
    expect(planTrade(book(), trader({ balance: 1 }), request({ shares: 100 }), NOW)).toMatchObject({
      code: "insufficient_balance",
    });
  });

  it("refuses a sell of shares that are not held", () => {
    expect(
      planTrade(book([40, 0]), trader({ positionShares: 5 }), request({ side: "sell", shares: 6 }), NOW),
    ).toMatchObject({ code: "insufficient_shares" });
  });

  it("refuses a buy whose price moved against the trader by more than the tolerance", () => {
    // Previewed against an empty book at 50 cents, executed against one already bought up.
    const rejected = planTrade(
      book([200, 0]),
      trader(),
      request({ shares: 10, previewAveragePrice: 0.5 }),
      NOW,
    );
    expect(rejected).toMatchObject({ code: "price_moved" });
    // The refusal carries the new quote, so the form can offer it.
    if (!rejected.ok) expect(rejected.quote?.averagePrice).toBeGreaterThan(0.5);
  });

  it("lets the trade through once the trader accepts the move", () => {
    const accepted = planTrade(
      book([200, 0]),
      trader(),
      request({ shares: 10, previewAveragePrice: 0.5, acceptSlippage: true }),
      NOW,
    );
    expect(accepted.ok).toBe(true);
  });

  it("does not refuse a move that went in the trader's favour", () => {
    const plan = planTrade(book(), trader(), request({ shares: 10, previewAveragePrice: 0.9 }), NOW);
    expect(plan.ok).toBe(true);
  });

  it("skips the check when nothing was previewed", () => {
    const plan = planTrade(book([200, 0]), trader(), request({ previewAveragePrice: 0 }), NOW);
    expect(plan.ok).toBe(true);
  });
});

/*
  The invariant the ledger has to keep: a balance is the sum of its deltas, a
  position is the sum of its fills, and the shares outstanding the book reports
  are the ones the AMM was priced against. Applying a sequence of plans to an
  in-memory copy of all three is the same arithmetic the store does, without a
  database in the way.
*/
describe("ledger and positions reconcile over a buy and sell sequence", () => {
  interface World {
    book: TradeBook;
    balance: number;
    ledger: number[];
    positionShares: number[];
    positionCostBasis: number[];
  }

  function apply(world: World, requested: TradeRequest): World {
    const index = world.book.outcomeIds.indexOf(requested.outcomeId);
    const plan = planTrade(
      world.book,
      {
        balance: world.balance,
        positionShares: world.positionShares[index],
        positionCostBasis: world.positionCostBasis[index],
      },
      requested,
      NOW,
    );
    if (!plan.ok) throw new Error(`refused: ${plan.code}`);

    const shares = world.book.sharesOutstanding.slice();
    shares[index] = plan.outcomeSharesAfter;
    const positionShares = world.positionShares.slice();
    positionShares[index] = plan.positionSharesAfter;
    const costBasis = world.positionCostBasis.slice();
    costBasis[index] = plan.positionCostBasisAfter;

    return {
      book: { ...world.book, sharesOutstanding: shares },
      balance: roundCredits(world.balance + plan.delta),
      ledger: [...world.ledger, plan.delta],
      positionShares,
      positionCostBasis: costBasis,
    };
  }

  const start: World = {
    book: book([0, 0, 0]),
    balance: 500,
    ledger: [500],
    positionShares: [0, 0, 0],
    positionCostBasis: [0, 0, 0],
  };

  it("keeps the balance equal to the sum of the ledger", () => {
    let world = start;
    for (const step of [
      { outcomeId: "o0", side: "buy" as const, shares: 30 },
      { outcomeId: "o1", side: "buy" as const, shares: 12.5 },
      { outcomeId: "o0", side: "sell" as const, shares: 10 },
      { outcomeId: "o2", side: "buy" as const, shares: 4 },
      { outcomeId: "o1", side: "sell" as const, shares: 12.5 },
    ]) {
      world = apply(world, request(step));
    }

    expect(world.balance).toBeCloseTo(
      roundCredits(world.ledger.reduce((total, delta) => total + delta, 0)),
      9,
    );
    expect(world.positionShares).toEqual([20, 0, 4]);
    expect(world.book.sharesOutstanding).toEqual([20, 0, 4]);
    // Nothing sold out leaves basis behind, and nothing held loses it.
    expect(world.positionCostBasis[1]).toBe(0);
    expect(world.positionCostBasis[0]).toBeGreaterThan(0);
  });

  it("never lets a round trip pay more than it cost", () => {
    let world = start;
    world = apply(world, request({ outcomeId: "o0", side: "buy", shares: 40 }));
    const spent = -world.ledger[world.ledger.length - 1];
    world = apply(world, request({ outcomeId: "o0", side: "sell", shares: 40 }));
    const returned = world.ledger[world.ledger.length - 1];

    expect(returned).toBeLessThanOrEqual(spent);
    expect(world.balance).toBeLessThanOrEqual(500);
    expect(world.positionShares[0]).toBe(0);
    expect(world.book.sharesOutstanding).toEqual([0, 0, 0]);
  });

  it("cannot spend a balance into the negative", () => {
    let world = { ...start, balance: 5, ledger: [5] };
    expect(() => {
      world = apply(world, request({ outcomeId: "o0", side: "buy", shares: 100 }));
    }).toThrow(/insufficient_balance/);
    expect(world.balance).toBe(5);
  });
});
