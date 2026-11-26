import { describe, expect, it } from "vitest";
import { betNet, betRecord, betState, formatReturn, isSettled, winScenario } from "./bets";

describe("winScenario", () => {
  it("pays one credit per share and shows the gap as profit", () => {
    // The production bet that read as "not paid": 832.4169 shares for 666.0786.
    const scenario = winScenario(832.4169, 666.0786);
    expect(scenario.payout).toBe(832.4169);
    expect(scenario.profit).toBe(166.3383);
    expect(scenario.returnRate).toBeCloseTo(0.2497, 4);
  });

  it("makes a near-certain buy look like what it is", () => {
    const scenario = winScenario(13_090.4651, 12_924.1098);
    expect(scenario.profit).toBe(166.3553);
    expect(formatReturn(scenario.returnRate)).toBe("+1.3%");
  });

  it("returns nothing for a free trade rather than dividing by zero", () => {
    expect(winScenario(0, 0).returnRate).toBe(0);
  });
});

describe("formatReturn", () => {
  it("rounds big returns to whole percents and keeps a decimal on small ones", () => {
    expect(formatReturn(0.25)).toBe("+25%");
    expect(formatReturn(1.5)).toBe("+150%");
    expect(formatReturn(0.034)).toBe("+3.4%");
    expect(formatReturn(-0.5)).toBe("-50%");
    expect(formatReturn(-0.0000004)).toBe("0%");
  });
});

describe("betState", () => {
  const now = new Date("2026-11-26T12:00:00Z");
  const before = new Date("2026-11-25T00:00:00Z");
  const after = new Date("2026-11-30T00:00:00Z");

  const flows = (bought: number, sold: number, paid: number) => ({ bought, sold, paid });

  it("is open only while the market takes trades", () => {
    expect(betState("open", after, flows(10, 0, 0), now)).toBe("open");
    // The nightly run has not flipped it yet, but the clock already closed it.
    expect(betState("open", before, flows(10, 0, 0), now)).toBe("settling");
    expect(betState("closed", before, flows(10, 0, 0), now)).toBe("settling");
  });

  it("names the result once settled", () => {
    expect(betState("resolved", before, flows(666.08, 0, 832.42), now)).toBe("won");
    expect(betState("resolved", before, flows(645.68, 0, 0), now)).toBe("lost");
    expect(betState("voided", before, flows(31, 0, 31), now)).toBe("refunded");
  });

  it("judges a resolved bet on its net, not on whether settling paid it", () => {
    // Sold out at a profit before close: paid nothing at settlement, still ahead.
    expect(betState("resolved", before, flows(100, 150, 0), now)).toBe("won");
    // A hedge that held one winning share and lost the rest.
    expect(betState("resolved", before, flows(500, 0, 1), now)).toBe("lost");
    expect(betState("resolved", before, flows(100, 100, 0), now)).toBe("even");
  });

  it("calls only won, lost, even and refunded settled", () => {
    expect(
      ["open", "settling", "won", "lost", "even", "refunded"].map((s) => isSettled(s as never)),
    ).toEqual([false, false, true, true, true, true]);
  });
});

describe("betNet", () => {
  it("is everything back less everything in", () => {
    expect(betNet({ bought: 666.0786, sold: 0, paid: 832.4169 })).toBe(166.3383);
    expect(betNet({ bought: 8408.3401, sold: 0, paid: 0 })).toBe(-8408.3401);
  });

  it("nets a voided market to zero instead of counting the stake as lost", () => {
    expect(betNet({ bought: 4756.7613, sold: 0, paid: 4756.7613 })).toBe(0);
  });

  it("keeps a loss already taken by selling when the market voids", () => {
    // Bought 100, sold half the shares for 30, the rest refunded at cost 50.
    expect(betNet({ bought: 100, sold: 30, paid: 50 })).toBe(-20);
  });
});

describe("betRecord", () => {
  it("counts only settled bets and sums their net", () => {
    expect(
      betRecord([
        { state: "won", net: 166.3383 },
        { state: "lost", net: -646 },
        { state: "refunded", net: 0 },
        { state: "open", net: null },
      ]),
    ).toEqual({ settled: 3, won: 1, lost: 1, net: -479.6617 });
  });
});
