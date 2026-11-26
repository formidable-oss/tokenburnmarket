import { describe, expect, it } from "vitest";
import { marketPreviewData, modelBurnChartData, statCells } from "./landing";

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

describe("modelBurnChartData", () => {
  const rows = [
    { day: "2026-08-14", model: "gpt-5.6-sol", tokens: 300_000_000 },
    { day: "2026-08-14", model: "claude-fable-5", tokens: 100_000_000 },
    { day: "2026-08-16", model: "gpt-5.6-sol", tokens: 400_000_000 },
    { day: "2026-08-16", model: "claude-fable-5", tokens: 8_000_000 },
  ];

  it("draws a running total per model, leader first, over every day up to today", () => {
    const chart = modelBurnChartData(rows, "2026-08-17", "this month");

    expect(chart.days).toEqual(["2026-08-14", "2026-08-15", "2026-08-16", "2026-08-17"]);
    expect(chart.lines).toEqual([
      {
        model: "gpt-5.6-sol",
        label: "GPT-5.6 Sol",
        cumulative: [300_000_000, 300_000_000, 700_000_000, 700_000_000],
        values: ["300M", "300M", "700M", "700M"],
      },
      {
        model: "claude-fable-5",
        label: "Claude Fable 5",
        cumulative: [100_000_000, 100_000_000, 108_000_000, 108_000_000],
        values: ["100M", "100M", "108M", "108M"],
      },
    ]);
  });

  it("names the Season and counts every model in the total", () => {
    const chart = modelBurnChartData(rows, "2026-08-17", "this month");
    expect(chart.live).toBe(true);
    expect(chart.total).toBe("808M tokens");
    expect(chart.season).toBe("this month");
  });

  it("keeps the leader inside the chart and puts round numbers on the axis", () => {
    const chart = modelBurnChartData(rows, "2026-08-17", "this month");
    expect(chart.top).toBeGreaterThan(700_000_000);
    expect(chart.ticks).toEqual([
      { value: 200_000_000, label: "200M" },
      { value: 400_000_000, label: "400M" },
      { value: 600_000_000, label: "600M" },
    ]);
  });

  it("draws only the leaders but still counts the rest", () => {
    const crowd = Array.from({ length: 7 }, (_, index) => ({
      day: "2026-08-17",
      model: `model-${index}`,
      tokens: (index + 1) * 1_000_000,
    }));
    const chart = modelBurnChartData(crowd, "2026-08-17", "this month");
    expect(chart.lines.map((line) => line.label)).toEqual([
      "Model 6",
      "Model 5",
      "Model 4",
      "Model 3",
      "Model 2",
    ]);
    expect(chart.total).toBe("28M tokens");
  });

  it("does not claim an empty global board is live", () => {
    const chart = modelBurnChartData([], "2026-08-17", "this month");
    expect(chart.live).toBe(false);
    expect(chart.lines).toEqual([]);
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
