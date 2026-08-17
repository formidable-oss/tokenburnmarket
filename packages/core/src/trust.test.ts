import { describe, expect, it } from "vitest";
import { mintForDay } from "./mint";
import { weakestTrustLevel } from "./trust";

describe("weakestTrustLevel", () => {
  it("lets a single Quarantined row decide the Builder-day", () => {
    expect(weakestTrustLevel(["verified", "reported", "quarantined"])).toBe("quarantined");
    expect(mintForDay(100, weakestTrustLevel(["verified", "quarantined"])).credits).toBe(0);
  });

  it("drops a day to Reported when any row lacks a Receipt Stream", () => {
    expect(weakestTrustLevel(["verified", "reported"])).toBe("reported");
  });

  it("stays Verified only when every row is", () => {
    expect(weakestTrustLevel(["verified", "verified"])).toBe("verified");
  });

  it("treats an empty day as Reported, since nothing was shown", () => {
    expect(weakestTrustLevel([])).toBe("reported");
  });
});
