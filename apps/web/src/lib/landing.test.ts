import { describe, expect, it } from "vitest";
import { marketPreviewData, modelUsagePreviewData, statCells } from "./landing";

const now = new Date("2026-08-17T12:00:00.000Z");

describe("marketPreviewData", () => {
  const market = {
    id: "0f3a1c2e-1111-4222-8333-444455556666",
    question: "Who burns most this week?",
    scope: "community" as const,
    communityName: "formidable",
    country: null,
    closesAt: new Date("2026-08-20T12:00:00.000Z"),
    creditsInPlay: 1240.5,
    outcomes: [
      { label: "@alex", price: 0.42 },
      { label: "@theo", price: 0.31 },
    ],
  };

  it("links to the market and names its audience", () => {
    const preview = marketPreviewData(market, now);
    expect(preview.href).toBe(`/m/${market.id}`);
    expect(preview.where).toBe("community · formidable");
  });

  it("says what is staked and when it closes", () => {
    const preview = marketPreviewData(market, now);
    expect(preview.inPlay).toBe("1,240.5 cr in play");
    expect(preview.closes).toBe("closes in 3d");
  });

  it("leaves a global market without an audience name", () => {
    const preview = marketPreviewData(
      { ...market, scope: "global", communityName: null },
      now,
    );
    expect(preview.where).toBe("global");
  });

  it("carries the outcomes through untouched, prices included", () => {
    expect(marketPreviewData(market, now).outcomes).toEqual([
      { label: "@alex", price: 0.42 },
      { label: "@theo", price: 0.31 },
    ]);
  });
});

describe("modelUsagePreviewData", () => {
  it("turns current global usage into model names, token totals and honest bar shares", () => {
    const preview = modelUsagePreviewData({
      totalTokens: 1_498_914_428,
      models: [
        { model: "gpt-5.6-sol", tokens: 703_353_949 },
        { model: "claude-fable-5", tokens: 108_034_583 },
      ],
    });

    expect(preview).toEqual({
      live: true,
      where: "global · this week",
      total: "1.5B tokens",
      question: "Models burning this week.",
      source: "synced usage · quarantined rows excluded",
      models: [
        { label: "GPT-5.6 Sol", value: "703.4M", share: 703_353_949 / 1_498_914_428 },
        { label: "Claude Fable 5", value: "108M", share: 108_034_583 / 1_498_914_428 },
      ],
    });
  });

  it("does not claim an empty global board is live", () => {
    expect(modelUsagePreviewData({ totalTokens: 0, models: [] }).live).toBe(false);
  });
});

describe("statCells", () => {
  it("gives every number a word", () => {
    const cells = statCells({
      buildersConnected: 128,
      weekCostUsd: 4821.66,
      openMarkets: 7,
      creditsInPlay: 15400.25,
    });
    expect(cells).toEqual([
      { label: "builders connected", value: "128" },
      { label: "burn this week", value: "$4,822" },
      { label: "open markets", value: "7" },
      { label: "credits in play", value: "15,400" },
    ]);
  });

  it("shows an empty site as zeros rather than hiding it", () => {
    const cells = statCells({
      buildersConnected: 0,
      weekCostUsd: 0,
      openMarkets: 0,
      creditsInPlay: 0,
    });
    expect(cells.map((cell) => cell.value)).toEqual(["0", "$0", "0", "0"]);
  });
});
