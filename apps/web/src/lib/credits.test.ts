/*
  The ledger is the only place a Builder sees what a Market paid them, so the
  row has to be able to point back at the Market it came from.
*/
import { describe, expect, it } from "vitest";
import { marketRef } from "./resolution";
import { creditEntryDay, creditEntryMarketId } from "./credits";

const MARKET = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe("creditEntryMarketId", () => {
  it("reads the market back out of a payout and a refund", () => {
    expect(creditEntryMarketId("payout", marketRef(MARKET))).toBe(MARKET);
    expect(creditEntryMarketId("refund", marketRef(MARKET))).toBe(MARKET);
  });

  it("points nowhere for the reasons that are not settlements", () => {
    expect(creditEntryMarketId("mint", "2026-08-17:0")).toBeNull();
    expect(creditEntryMarketId("buy", MARKET)).toBeNull();
    expect(creditEntryMarketId("payout", null)).toBeNull();
    expect(creditEntryMarketId("payout", "market:not-a-uuid")).toBeNull();
  });

  it("leaves the mint's day where it was", () => {
    expect(creditEntryDay("mint", "2026-08-17:1")).toBe("2026-08-17");
    expect(creditEntryDay("payout", marketRef(MARKET))).toBeNull();
  });
});
