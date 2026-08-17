import { describe, expect, it } from "vitest";
import {
  metricValue,
  parseBoardQuery,
  periodRange,
  previousPeriodRange,
  rankEntries,
  type BoardEntry,
} from "./leaderboard";

function entry(handle: string, values: Partial<BoardEntry> = {}): BoardEntry {
  return {
    builderId: handle,
    handle,
    avatarUrl: null,
    costUsd: 0,
    totalTokens: 0,
    creditsWon: 0,
    reported: false,
    ...values,
  };
}

describe("periodRange", () => {
  it("runs a week from Monday to Sunday UTC", () => {
    // 2026-08-17 is a Monday.
    expect(periodRange("week", new Date("2026-08-19T13:00:00Z"))).toEqual({
      start: "2026-08-17",
      end: "2026-08-23",
    });
  });

  it("keeps Sunday in the week that started six days earlier", () => {
    expect(periodRange("week", new Date("2026-08-23T23:59:59Z"))).toEqual({
      start: "2026-08-17",
      end: "2026-08-23",
    });
  });

  it("starts a new week at Monday midnight UTC", () => {
    expect(periodRange("week", new Date("2026-08-24T00:00:00Z")).start).toBe("2026-08-24");
  });

  it("covers the calendar month, including a leap February", () => {
    expect(periodRange("month", new Date("2026-08-19T00:00:00Z"))).toEqual({
      start: "2026-08-01",
      end: "2026-08-31",
    });
    expect(periodRange("month", new Date("2028-02-10T00:00:00Z")).end).toBe("2028-02-29");
  });

  it("leaves all-time open at the start", () => {
    expect(periodRange("all", new Date("2026-08-19T00:00:00Z"))).toEqual({
      start: null,
      end: "2026-08-19",
    });
  });
});

describe("previousPeriodRange", () => {
  it("is the seven days before this week", () => {
    expect(previousPeriodRange("week", new Date("2026-08-19T00:00:00Z"))).toEqual({
      start: "2026-08-10",
      end: "2026-08-16",
    });
  });

  it("crosses a year boundary by month", () => {
    expect(previousPeriodRange("month", new Date("2026-01-15T00:00:00Z"))).toEqual({
      start: "2025-12-01",
      end: "2025-12-31",
    });
  });

  it("has none for all-time", () => {
    expect(previousPeriodRange("all", new Date("2026-08-19T00:00:00Z"))).toBeNull();
  });
});

describe("rankEntries", () => {
  const entries = [
    entry("mira", { costUsd: 740, totalTokens: 90, creditsWon: -40 }),
    entry("theo", { costUsd: 1284, totalTokens: 10, creditsWon: 312 }),
    entry("alex", { costUsd: 962, totalTokens: 50, creditsWon: 518 }),
  ];

  it("ranks by the chosen metric, heaviest first", () => {
    expect(rankEntries(entries, "cost").map((row) => [row.rank, row.handle])).toEqual([
      [1, "theo"],
      [2, "alex"],
      [3, "mira"],
    ]);
    expect(rankEntries(entries, "tokens").map((row) => row.handle)).toEqual([
      "mira",
      "alex",
      "theo",
    ]);
    expect(rankEntries(entries, "credits").map((row) => row.handle)).toEqual([
      "alex",
      "theo",
      "mira",
    ]);
  });

  it("carries the metric it ranked by as the row value", () => {
    const rows = rankEntries(entries, "credits");
    expect(rows.map((row) => row.value)).toEqual([518, 312, -40]);
    expect(rows.every((row) => row.value === metricValue(row, "credits"))).toBe(true);
  });

  it("gives tied Builders the same rank and skips the next", () => {
    const tied = [
      entry("a", { costUsd: 10 }),
      entry("b", { costUsd: 10 }),
      entry("c", { costUsd: 5 }),
    ];
    expect(rankEntries(tied, "cost").map((row) => [row.handle, row.rank])).toEqual([
      ["a", 1],
      ["b", 1],
      ["c", 3],
    ]);
  });

  it("breaks ties on handle, so two identical reads agree", () => {
    const zeros = [entry("zoe"), entry("ana"), entry("mel")];
    expect(rankEntries(zeros, "credits").map((row) => row.handle)).toEqual(["ana", "mel", "zoe"]);
  });

  it("reports places gained against the previous period", () => {
    const previous = [
      entry("mira", { costUsd: 5000 }),
      entry("theo", { costUsd: 400 }),
      entry("alex", { costUsd: 300 }),
    ];
    const byHandle = new Map(
      rankEntries(entries, "cost", previous).map((row) => [row.handle, row.rankChange]),
    );
    expect(byHandle.get("theo")).toBe(1);
    expect(byHandle.get("alex")).toBe(1);
    expect(byHandle.get("mira")).toBe(-2);
  });

  it("reads a Builder absent from the previous period as new", () => {
    const rows = rankEntries(entries, "cost", [entry("theo", { costUsd: 400 })]);
    expect(rows.find((row) => row.handle === "alex")?.rankChange).toBeNull();
  });

  it("has no rank change when no previous period is given", () => {
    expect(rankEntries(entries, "cost").every((row) => row.rankChange === null)).toBe(true);
  });
});

describe("parseBoardQuery", () => {
  it("defaults to this week by cost", () => {
    expect(parseBoardQuery({})).toEqual({ period: "week", metric: "cost" });
  });

  it("takes what it recognises and ignores the rest", () => {
    expect(parseBoardQuery({ period: "month", metric: "credits" })).toEqual({
      period: "month",
      metric: "credits",
    });
    expect(parseBoardQuery({ period: "fortnight", metric: "vibes" })).toEqual({
      period: "week",
      metric: "cost",
    });
  });

  it("takes the first value when a param repeats", () => {
    expect(parseBoardQuery({ period: ["all", "week"] }).period).toBe("all");
  });
});
