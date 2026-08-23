/*
  The templates as a market maker cares about them: params that a resolver can
  settle alone, Outcomes that always have a row for the answer, and a rules
  sentence that says what settles it in words a person reads.
*/
import { describe, expect, it } from "vitest";
import {
  MAX_TEMPLATE_OUTCOMES,
  MarketTemplateParamsSchema,
  SOMEONE_ELSE_LABEL,
  autoMarketKey,
  buildTemplateOutcomes,
  buildTopBurnerOutcomes,
  formatPeriodShort,
  marketTemplateQuestion,
  marketTemplateRulesText,
  nextUtcWeek,
  parseTemplateParams,
  periodClosesAt,
  utcDayOf,
  utcWeekOf,
  type HeadToHeadParams,
  type MarketPeriod,
  type MemberSnapshot,
  type ModelRaceParams,
  type ThresholdParams,
  type TopBurnerParams,
} from "./market-templates";

const COMMUNITY = "33333333-3333-4333-8333-333333333333";
const ALEX = "11111111-1111-4111-8111-111111111111";
const THEO = "22222222-2222-4222-8222-222222222222";

const WEEK: MarketPeriod = { start: "2026-08-17", end: "2026-08-23" };
const scope = { kind: "community", communityId: COMMUNITY, communityName: "Formidable" } as const;

const topBurner: TopBurnerParams = { template: "top_burner", scope, period: WEEK };
const threshold: ThresholdParams = {
  template: "threshold",
  scope,
  period: WEEK,
  threshold: { builderId: ALEX, handle: "alex", costUsd: 50 },
};
const headToHead: HeadToHeadParams = {
  template: "head_to_head",
  scope,
  period: WEEK,
  pair: [
    { builderId: ALEX, handle: "alex" },
    { builderId: THEO, handle: "theo" },
  ],
};
const modelRace: ModelRaceParams = {
  template: "model_race",
  scope: { kind: "global" },
  period: WEEK,
  models: ["claude-opus-4", "gpt-5"],
};

function members(count: number): MemberSnapshot[] {
  return Array.from({ length: count }, (_, index) => ({
    builderId: `${index}`.padStart(8, "0") + "-0000-4000-8000-000000000000",
    handle: `builder${index}`,
  }));
}

describe("param validation", () => {
  it("accepts every template's params", () => {
    for (const params of [topBurner, threshold, headToHead, modelRace]) {
      expect(MarketTemplateParamsSchema.safeParse(params).success).toBe(true);
    }
  });

  it("rejects a period that ends before it starts", () => {
    const params = { ...topBurner, period: { start: "2026-08-23", end: "2026-08-17" } };
    expect(MarketTemplateParamsSchema.safeParse(params).success).toBe(false);
  });

  it("rejects a day that is not a UTC calendar day", () => {
    const params = { ...topBurner, period: { start: "17/08/2026", end: "2026-08-23" } };
    expect(MarketTemplateParamsSchema.safeParse(params).success).toBe(false);
  });

  it("rejects a threshold of zero or less", () => {
    const params = { ...threshold, threshold: { ...threshold.threshold, costUsd: 0 } };
    expect(MarketTemplateParamsSchema.safeParse(params).success).toBe(false);
  });

  it("rejects a builder racing themselves", () => {
    const params = {
      ...headToHead,
      pair: [
        { builderId: ALEX, handle: "alex" },
        { builderId: ALEX, handle: "alex" },
      ],
    };
    expect(MarketTemplateParamsSchema.safeParse(params).success).toBe(false);
  });

  it("rejects a model race that names one model twice", () => {
    const params = { ...modelRace, models: ["gpt-5", "gpt-5"] };
    expect(MarketTemplateParamsSchema.safeParse(params).success).toBe(false);
  });

  it("rejects unknown keys, so a param a resolver ignores cannot be stored", () => {
    expect(MarketTemplateParamsSchema.safeParse({ ...topBurner, winner: ALEX }).success).toBe(false);
  });

  it("reads stored params back, and says no to params that are not a template", () => {
    expect(parseTemplateParams(topBurner)).toEqual(topBurner);
    expect(parseTemplateParams({ rules: "whatever" })).toBeNull();
    expect(parseTemplateParams(null)).toBeNull();
  });
});

describe("outcomes", () => {
  it("names every member and adds someone else", () => {
    const rows = buildTopBurnerOutcomes(members(3));
    expect(rows.map((row) => row.label)).toEqual([
      "@builder0",
      "@builder1",
      "@builder2",
      SOMEONE_ELSE_LABEL,
    ]);
    expect(rows.map((row) => row.sort)).toEqual([0, 1, 2, 3]);
    expect(rows.at(-1)!.ref).toEqual({
      kind: "builder_other",
      excludes: members(3).map((member) => member.builderId),
    });
  });

  it("keeps someone else even in a community of one", () => {
    expect(buildTopBurnerOutcomes(members(1))).toHaveLength(2);
  });

  it("caps at the outcome limit and still leaves room for someone else", () => {
    const rows = buildTopBurnerOutcomes(members(40));
    expect(rows).toHaveLength(MAX_TEMPLATE_OUTCOMES);
    expect(rows.at(-1)!.label).toBe(SOMEONE_ELSE_LABEL);
    // Dropped members are covered by the escape hatch rather than by nothing.
    expect((rows.at(-1)!.ref as { excludes: string[] }).excludes).toHaveLength(
      MAX_TEMPLATE_OUTCOMES - 1,
    );
  });

  it("drops a member listed twice instead of pricing them twice", () => {
    const [first] = members(1);
    expect(buildTopBurnerOutcomes([first, first])).toHaveLength(2);
  });

  it("refuses a top burner with nobody in it", () => {
    expect(() => buildTopBurnerOutcomes([])).toThrow(RangeError);
  });

  it("gives a threshold two sides that name the amount", () => {
    expect(buildTemplateOutcomes(threshold).map((row) => row.label)).toEqual([
      "$50 or more",
      "under $50",
    ]);
  });

  it("gives a head-to-head the two builders in the order named", () => {
    expect(buildTemplateOutcomes(headToHead).map((row) => row.label)).toEqual(["@alex", "@theo"]);
  });

  it("gives a model race the models plus another model", () => {
    const rows = buildTemplateOutcomes(modelRace);
    expect(rows.map((row) => row.label)).toEqual(["claude-opus-4", "gpt-5", "another model"]);
  });

  it("never builds fewer than the two outcomes an AMM needs", () => {
    for (const params of [threshold, headToHead, modelRace]) {
      expect(buildTemplateOutcomes(params).length).toBeGreaterThanOrEqual(2);
    }
    expect(buildTemplateOutcomes(topBurner, members(1)).length).toBeGreaterThanOrEqual(2);
  });
});

describe("questions and rules text", () => {
  it("asks each template's question", () => {
    expect(marketTemplateQuestion(topBurner)).toBe("Who burns most in Formidable, 17-23 Aug 2026?");
    expect(marketTemplateQuestion(threshold)).toBe(
      "Does @alex burn $50 or more, 17-23 Aug 2026?",
    );
    expect(marketTemplateQuestion(headToHead)).toBe(
      "Does @alex out-burn @theo, 17-23 Aug 2026?",
    );
    expect(marketTemplateQuestion(modelRace)).toBe("Which model burns most anywhere, 17-23 Aug 2026?");
  });

  it("says what is measured, over which days, and what a winning share pays", () => {
    const rules = marketTemplateRulesText(topBurner);
    expect(rules).toContain("highest usage cost");
    expect(rules).toContain("Usage from 17 Aug 2026 to 23 Aug 2026 UTC decides it.");
    expect(rules).toContain("A winning share pays 1 credit.");
  });

  it("explains someone else as the late joiner's row", () => {
    expect(marketTemplateRulesText(topBurner)).toContain("joins late");
  });

  it("says a tie voids a head-to-head, rather than leaving it unsaid", () => {
    expect(marketTemplateRulesText(headToHead)).toContain("a tie voids the market");
  });

  it("keeps the house voice: no em dashes, no exclamation marks", () => {
    for (const params of [topBurner, threshold, headToHead, modelRace]) {
      const text = `${marketTemplateQuestion(params)} ${marketTemplateRulesText(params)}`;
      expect(text).not.toMatch(/[—!]/);
    }
  });

  it("shortens a period only as far as both ends agree", () => {
    expect(formatPeriodShort({ start: "2026-08-17", end: "2026-08-23" })).toBe("17-23 Aug 2026");
    expect(formatPeriodShort({ start: "2026-08-31", end: "2026-09-06" })).toBe(
      "31 Aug to 6 Sep 2026",
    );
    expect(formatPeriodShort({ start: "2026-12-28", end: "2027-01-03" })).toBe(
      "28 Dec 2026 to 3 Jan 2027",
    );
  });
});

describe("weeks", () => {
  it("cuts a daily market on the current UTC date", () => {
    expect(utcDayOf(new Date("2026-08-18T23:59:00.000Z"))).toEqual({
      start: "2026-08-18",
      end: "2026-08-18",
    });
  });

  it("runs Monday to Sunday UTC, whichever day it is asked on", () => {
    // 2026-08-17 is a Monday; 2026-08-23 the Sunday that closes the same week.
    expect(utcWeekOf(new Date("2026-08-17T00:00:00.000Z"))).toEqual(WEEK);
    expect(utcWeekOf(new Date("2026-08-23T23:59:59.000Z"))).toEqual(WEEK);
    expect(utcWeekOf(new Date("2026-08-24T00:00:00.000Z"))).toEqual({
      start: "2026-08-24",
      end: "2026-08-30",
    });
  });

  it("hands out the next week without touching the calendar twice", () => {
    expect(nextUtcWeek(new Date("2026-08-19T12:00:00.000Z"))).toEqual({
      start: "2026-08-24",
      end: "2026-08-30",
    });
  });

  it("closes trading at midnight after the last measured day", () => {
    expect(periodClosesAt(WEEK).toISOString()).toBe("2026-08-24T00:00:00.000Z");
  });

  it("keys a week's market by scope and Monday, so a re-run finds it", () => {
    expect(autoMarketKey("top_burner", COMMUNITY, WEEK)).toBe(`top_burner:${COMMUNITY}:2026-08-17`);
    expect(autoMarketKey("model_race", "global", WEEK)).toBe("model_race:global:2026-08-17");
  });
});
