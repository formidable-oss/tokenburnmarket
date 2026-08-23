import { describe, expect, it } from "vitest";
import { MODEL_RANKING_WINDOW_DAYS, modelRankingSince } from "./market-queries";

describe("model market ranking window", () => {
  it("uses the trailing seven UTC days so retired models age out quickly", () => {
    expect(MODEL_RANKING_WINDOW_DAYS).toBe(7);
    expect(modelRankingSince(new Date("2026-08-23T23:59:00.000Z"))).toBe("2026-08-17");
  });
});
