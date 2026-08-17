/*
  Resolver fixtures. One per template, plus the three cases that decide whether
  a resolver is trustworthy: a tie, missing Usage, and a Quarantined
  participant.
*/
import { describe, expect, it } from "vitest";
import {
  buildModelRaceOutcomes,
  buildTopBurnerOutcomes,
  type HeadToHeadParams,
  type ModelRaceParams,
  type ThresholdParams,
  type TopBurnerParams,
} from "./market-templates";
import {
  QUARANTINE_HOLD_REASON,
  outcomeRefMatches,
  resolveMarket,
  type BuilderUsageSnapshot,
  type ResolutionSnapshot,
} from "./resolve";

const PERIOD = { start: "2026-08-17", end: "2026-08-23" };
const COMMUNITY = {
  kind: "community",
  communityId: "11111111-1111-4111-8111-111111111111",
  communityName: "Nightshift",
} as const;

const ADA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BEN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CHE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function builder(
  builderId: string,
  handle: string,
  costUsd: number,
  totalTokens = 0,
  quarantined = false,
): BuilderUsageSnapshot {
  return { builderId, handle, costUsd, totalTokens, quarantined };
}

function snapshot(partial: Partial<ResolutionSnapshot>): ResolutionSnapshot {
  return { builders: [], models: [], ...partial };
}

const topBurner: TopBurnerParams = { template: "top_burner", scope: COMMUNITY, period: PERIOD };

const threshold: ThresholdParams = {
  template: "threshold",
  scope: COMMUNITY,
  period: PERIOD,
  threshold: { builderId: ADA, handle: "ada", costUsd: 50 },
};

const headToHead: HeadToHeadParams = {
  template: "head_to_head",
  scope: COMMUNITY,
  period: PERIOD,
  pair: [
    { builderId: ADA, handle: "ada" },
    { builderId: BEN, handle: "ben" },
  ],
};

const modelRace: ModelRaceParams = {
  template: "model_race",
  scope: { kind: "global" },
  period: PERIOD,
  models: ["claude-opus-4", "gpt-5"],
};

describe("resolveMarket: top burner", () => {
  it("gives it to the highest usage cost", () => {
    const resolution = resolveMarket(
      topBurner,
      snapshot({ builders: [builder(ADA, "ada", 12), builder(BEN, "ben", 31)] }),
    );
    expect(resolution).toEqual({ kind: "win", winningOutcomeRef: { kind: "builder", builderId: BEN } });
  });

  it("breaks a tie on cost with tokens, then with the handle", () => {
    const tiedOnCost = resolveMarket(
      topBurner,
      snapshot({ builders: [builder(ADA, "ada", 20, 1_000), builder(BEN, "ben", 20, 9_000)] }),
    );
    expect(tiedOnCost).toMatchObject({ winningOutcomeRef: { builderId: BEN } });

    const tiedOnBoth = resolveMarket(
      topBurner,
      snapshot({ builders: [builder(BEN, "ben", 20, 500), builder(ADA, "ada", 20, 500)] }),
    );
    expect(tiedOnBoth).toMatchObject({ winningOutcomeRef: { builderId: ADA } });
  });

  it("voids when nobody in scope burned anything", () => {
    const resolution = resolveMarket(
      topBurner,
      snapshot({ builders: [builder(ADA, "ada", 0), builder(BEN, "ben", 0)] }),
    );
    expect(resolution).toEqual({
      kind: "void",
      reason: "Nobody in scope burned anything over the period.",
    });
  });

  it("voids when there is no usage at all", () => {
    expect(resolveMarket(topBurner, snapshot({})).kind).toBe("void");
  });

  it("holds while any builder in scope has a quarantined day", () => {
    const resolution = resolveMarket(
      topBurner,
      snapshot({
        builders: [builder(ADA, "ada", 40), builder(BEN, "ben", 3, 0, true)],
      }),
    );
    expect(resolution).toEqual({ kind: "hold", reason: QUARANTINE_HOLD_REASON });
  });

  it("hands an unnamed winner to someone else", () => {
    const outcomes = buildTopBurnerOutcomes([
      { builderId: ADA, handle: "ada" },
      { builderId: BEN, handle: "ben" },
    ]);
    const resolution = resolveMarket(
      topBurner,
      snapshot({ builders: [builder(ADA, "ada", 5), builder(CHE, "che", 99)] }),
    );
    if (resolution.kind !== "win") throw new Error("expected a winner");

    const winning = outcomes.filter((outcome) =>
      outcomeRefMatches(outcome.ref, resolution.winningOutcomeRef),
    );
    expect(winning).toHaveLength(1);
    expect(winning[0].label).toBe("someone else");
  });
});

describe("resolveMarket: threshold", () => {
  it("settles yes at the amount and no under it", () => {
    expect(
      resolveMarket(threshold, snapshot({ builders: [builder(ADA, "ada", 50)] })),
    ).toMatchObject({ winningOutcomeRef: { kind: "threshold_met" } });
    expect(
      resolveMarket(threshold, snapshot({ builders: [builder(ADA, "ada", 49.99)] })),
    ).toMatchObject({ winningOutcomeRef: { kind: "threshold_missed" } });
  });

  it("treats a builder with no usage as under the amount", () => {
    expect(resolveMarket(threshold, snapshot({}))).toMatchObject({
      winningOutcomeRef: { kind: "threshold_missed" },
    });
  });

  it("ignores a quarantined builder who is not the one named", () => {
    const resolution = resolveMarket(
      threshold,
      snapshot({ builders: [builder(ADA, "ada", 80), builder(BEN, "ben", 5, 0, true)] }),
    );
    expect(resolution).toMatchObject({ winningOutcomeRef: { kind: "threshold_met" } });
  });

  it("holds when the named builder is quarantined", () => {
    const resolution = resolveMarket(
      threshold,
      snapshot({ builders: [builder(ADA, "ada", 80, 0, true)] }),
    );
    expect(resolution).toEqual({ kind: "hold", reason: QUARANTINE_HOLD_REASON });
  });
});

describe("resolveMarket: head to head", () => {
  it("gives it to whoever burned more", () => {
    const resolution = resolveMarket(
      headToHead,
      snapshot({ builders: [builder(ADA, "ada", 10), builder(BEN, "ben", 11)] }),
    );
    expect(resolution).toMatchObject({ winningOutcomeRef: { builderId: BEN } });
  });

  it("voids a tie, as the rules sentence promises", () => {
    const resolution = resolveMarket(
      headToHead,
      snapshot({ builders: [builder(ADA, "ada", 10, 1), builder(BEN, "ben", 10, 900)] }),
    );
    expect(resolution).toEqual({ kind: "void", reason: "The two builders tied on usage cost." });
  });

  it("voids when neither builder synced anything", () => {
    expect(resolveMarket(headToHead, snapshot({})).kind).toBe("void");
  });

  it("holds when either side is quarantined", () => {
    const resolution = resolveMarket(
      headToHead,
      snapshot({ builders: [builder(ADA, "ada", 10), builder(BEN, "ben", 2, 0, true)] }),
    );
    expect(resolution).toEqual({ kind: "hold", reason: QUARANTINE_HOLD_REASON });
  });
});

describe("resolveMarket: model race", () => {
  it("gives it to the most tokens", () => {
    const resolution = resolveMarket(
      modelRace,
      snapshot({
        models: [
          { model: "claude-opus-4", totalTokens: 10 },
          { model: "gpt-5", totalTokens: 40 },
        ],
      }),
    );
    expect(resolution).toMatchObject({ winningOutcomeRef: { kind: "model", model: "gpt-5" } });
  });

  it("breaks a tie by the order the params name the models", () => {
    const resolution = resolveMarket(
      modelRace,
      snapshot({
        models: [
          { model: "gpt-5", totalTokens: 40 },
          { model: "claude-opus-4", totalTokens: 40 },
        ],
      }),
    );
    expect(resolution).toMatchObject({ winningOutcomeRef: { model: "claude-opus-4" } });
  });

  it("keeps a tie away from an unnamed model", () => {
    const resolution = resolveMarket(
      modelRace,
      snapshot({
        models: [
          { model: "aardvark-1", totalTokens: 40 },
          { model: "gpt-5", totalTokens: 40 },
        ],
      }),
    );
    expect(resolution).toMatchObject({ winningOutcomeRef: { model: "gpt-5" } });
  });

  it("hands an unnamed winner to another model", () => {
    const outcomes = buildModelRaceOutcomes(modelRace);
    const resolution = resolveMarket(
      modelRace,
      snapshot({
        models: [
          { model: "gpt-5", totalTokens: 10 },
          { model: "gemini-2.5-pro", totalTokens: 90 },
        ],
      }),
    );
    if (resolution.kind !== "win") throw new Error("expected a winner");

    const winning = outcomes.filter((outcome) =>
      outcomeRefMatches(outcome.ref, resolution.winningOutcomeRef),
    );
    expect(winning).toHaveLength(1);
    expect(winning[0].label).toBe("another model");
  });

  it("voids when no model burned anything", () => {
    const resolution = resolveMarket(
      modelRace,
      snapshot({ models: [{ model: "gpt-5", totalTokens: 0 }] }),
    );
    expect(resolution.kind).toBe("void");
  });

  it("holds when a builder feeding the totals is quarantined", () => {
    const resolution = resolveMarket(
      modelRace,
      snapshot({
        builders: [builder(ADA, "ada", 4, 100, true)],
        models: [{ model: "gpt-5", totalTokens: 100 }],
      }),
    );
    expect(resolution).toEqual({ kind: "hold", reason: QUARANTINE_HOLD_REASON });
  });
});

describe("outcomeRefMatches", () => {
  it("keeps a named builder away from the pooled row", () => {
    const outcomes = buildTopBurnerOutcomes([
      { builderId: ADA, handle: "ada" },
      { builderId: BEN, handle: "ben" },
    ]);
    const winner = { kind: "builder", builderId: ADA } as const;
    const matched = outcomes.filter((outcome) => outcomeRefMatches(outcome.ref, winner));
    expect(matched).toHaveLength(1);
    expect(matched[0].label).toBe("@ada");
  });

  it("never matches a threshold row against a builder", () => {
    expect(outcomeRefMatches({ kind: "threshold_met" }, { kind: "builder", builderId: ADA })).toBe(
      false,
    );
  });
});
