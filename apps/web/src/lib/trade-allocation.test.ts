import { lmsrQuote } from "@tokenburnmarket/core";
import { describe, expect, it } from "vitest";
import {
  allocationBudget,
  displayedTradeAmount,
  sharesForBalanceAllocation,
} from "./trade-allocation";

describe("trade balance allocation", () => {
  it("turns a percentage into a Credit budget without exceeding the balance", () => {
    expect(allocationBudget(1_000, 25)).toBe(250);
    expect(allocationBudget(123.4567, 100)).toBe(123.4567);
    expect(allocationBudget(100, 140)).toBe(100);
    expect(allocationBudget(100, -10)).toBe(0);
  });

  it("buys the largest share amount that fits the selected allocation", () => {
    const book = [40, 10, 0];
    const budget = allocationBudget(800, 25);
    const shares = sharesForBalanceAllocation({
      sharesOutstanding: book,
      b: 50,
      outcomeIndex: 0,
      balance: 800,
      percent: 25,
    });

    expect(shares).toBeGreaterThan(0);
    expect(lmsrQuote(book, 50, 0, "buy", shares).credits).toBeLessThanOrEqual(budget);
    expect(lmsrQuote(book, 50, 0, "buy", shares + 0.0001).credits).toBeGreaterThan(budget);
  });

  it("returns no shares when no balance or outcome is available", () => {
    const input = { sharesOutstanding: [0, 0], b: 50, outcomeIndex: 0, percent: 25 };

    expect(sharesForBalanceAllocation({ ...input, balance: 0 })).toBe(0);
    expect(sharesForBalanceAllocation({ ...input, balance: 100, outcomeIndex: -1 })).toBe(0);
  });

  it("clears the submitted amount until the next trade is edited", () => {
    const completed = {
      manualAmount: "5000",
      allocatedShares: null,
      lastTradeFilled: true,
    };

    expect(displayedTradeAmount({ ...completed, editingNextTrade: false })).toBe("");
    expect(displayedTradeAmount({ ...completed, editingNextTrade: true })).toBe("5000");
  });
});
