import { describe, expect, it } from "vitest";
import {
  boardCard,
  boardTitle,
  CARD_BOARD_ROWS,
  CARD_OUTCOMES,
  headlineFontSize,
  marketCard,
  profileCard,
  profileTitle,
  siteCard,
  truncate,
} from "./share-cards";

/** Copy rules from DESIGN.md that a card must not break, wherever the words come from. */
function expectHouseStyle(text: string) {
  expect(text).not.toMatch(/—|–/);
  expect(text).not.toContain("!");
}

describe("headlineFontSize", () => {
  it("shrinks as the headline grows", () => {
    const sizes = ["@alex", "Who burns most this week?", "x".repeat(60), "x".repeat(140)].map(
      headlineFontSize,
    );
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
  });
});

describe("truncate", () => {
  it("leaves short text alone", () => {
    expect(truncate("short", 20)).toBe("short");
  });

  it("never returns more characters than the limit", () => {
    expect(truncate("x".repeat(50), 20).length).toBeLessThanOrEqual(20);
  });

  it("cuts on a word boundary when there is a late one", () => {
    expect(truncate("who burns most this week in Romania", 20)).toBe("who burns most…");
  });
});

describe("profileCard", () => {
  const card = profileCard({
    handle: "alexconstantin",
    weekCostUsd: 412.4,
    monthCostUsd: 1830.9,
    creditBalance: 179.3234,
    trust: "reported",
  });

  it("leads with the handle and says the Trust Level in words", () => {
    expect(card.headline).toBe("@alexconstantin");
    expect(card.eyebrow).toContain("reported");
  });

  it("shows burn this week, burn this month and credits, rounded", () => {
    expect(card.rows?.map((row) => [row.label, row.value])).toEqual([
      ["this week", "$412"],
      ["this month", "$1,831"],
      ["credits", "179"],
    ]);
  });

  it("keeps the house style", () => {
    expectHouseStyle(`${card.subline} ${card.alt} ${card.footer}`);
  });
});

describe("profileTitle", () => {
  it("reads as the share sentence", () => {
    expect(profileTitle("theo", 1234)).toBe("@theo burns $1,234 this week");
  });
});

describe("marketCard", () => {
  const card = marketCard({
    question: "Who burns most this week in the formidable community?",
    scopeLine: "community · formidable",
    closesLine: "closes in 3d",
    outcomes: [
      { label: "@mira", price: 0.19 },
      { label: "@alex", price: 0.42 },
      { label: "someone else with a very long label", price: 0.08 },
      { label: "@theo", price: 0.31 },
    ],
  });

  it("quotes the three likeliest outcomes, dearest first", () => {
    expect(card.rows).toHaveLength(CARD_OUTCOMES);
    expect(card.rows?.map((row) => row.label)).toEqual(["@alex", "@theo", "@mira"]);
    expect(card.rows?.map((row) => row.value)).toEqual(["42¢", "31¢", "19¢"]);
  });

  it("draws each price as its own bar and paints it as a price", () => {
    expect(card.rows?.map((row) => row.fill)).toEqual([0.42, 0.31, 0.19]);
    expect(card.rows?.every((row) => row.tone === "price")).toBe(true);
  });

  it("shortens a question that would not fit", () => {
    const long = marketCard({
      question: "w".repeat(140),
      scopeLine: "global",
      closesLine: "closes in 1d",
      outcomes: [],
    });
    expect(long.headline.length).toBeLessThanOrEqual(90);
    expect(long.rows).toEqual([]);
  });

  it("keeps the scope and the close on the card", () => {
    expect(card.eyebrow).toBe("community · formidable");
    expect(card.footer).toBe("closes in 3d");
    expectHouseStyle(`${card.subline} ${card.alt}`);
  });
});

describe("boardCard", () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({
    rank: i + 1,
    handle: `builder${i + 1}`,
    value: `$${100 - i}`,
  }));

  it("shows five ranks with zero-padded numbers", () => {
    const card = boardCard({ name: "Europe", period: "week", metric: "cost", rows, kind: "region" });
    expect(card.rows).toHaveLength(CARD_BOARD_ROWS);
    expect(card.rows?.[0]).toEqual({ label: "01 builder1", value: "$100" });
    expect(card.panelTitle).toBe("top 5 by cost");
  });

  it("names the Season and the scope kind", () => {
    const card = boardCard({
      name: "formidable",
      period: "month",
      metric: "credits",
      rows,
      kind: "community",
      total: "+4,000",
    });
    expect(card.eyebrow).toBe("community · this month");
    expect(card.footer).toBe("formidable · this month");
    expect(card.subline).toContain("+4,000");
  });

  it("says what an empty board means instead of showing nothing", () => {
    const card = boardCard({ name: "Romania", period: "week", metric: "cost", rows: [], kind: "region" });
    expect(card.rows).toEqual([]);
    expect(card.subline).toContain("Nobody has burned here yet");
    expectHouseStyle(card.subline!);
  });
});

describe("boardTitle", () => {
  it("is the region and the Season", () => {
    expect(boardTitle("Europe", "week")).toBe("Europe board · this week");
  });
});

describe("siteCard", () => {
  it("paints exactly one word primary", () => {
    const card = siteCard();
    expect(card.accent).toBe("burn");
    expect(card.headline).toContain(card.accent!);
    expectHouseStyle(`${card.headline} ${card.subline} ${card.footer}`);
  });
});
