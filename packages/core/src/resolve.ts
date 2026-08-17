// Settling a Market from Usage. Pure: a snapshot of the period goes in, an
// Outcome comes out, and nothing here reads a database or a clock.
//
// Three answers are possible, and only three:
//
//   win   the measured winner, as the thing that won rather than as an Outcome
//         id. The caller matches it against the Market's Outcomes, which is
//         where the "someone else" and "another model" rows earn their keep.
//   hold  the Usage that decides it is Quarantined, so the answer is not
//         knowable yet. The caller waits and asks again.
//   void  the Usage says nothing usable, or the rules say a tie cancels it.
//         Positions are refunded at cost.
//
// A Quarantined day is under review (ADR 0003): it is excluded from the totals
// here, and its presence among the Builders a Market points at is what makes
// the answer a hold rather than a wrong number.

import type {
  HeadToHeadParams,
  MarketTemplateParams,
  ModelRaceParams,
  OutcomeRef,
  ThresholdParams,
  TopBurnerParams,
} from "./market-templates";

/** One Builder's Usage over a Market's period, as the resolver reads it. */
export interface BuilderUsageSnapshot {
  builderId: string;
  /** Handle, which is the last tie-break: an answer must not depend on row order. */
  handle: string;
  /** Cost in USD over the period, Quarantined days excluded. */
  costUsd: number;
  /** Tokens over the period, Quarantined days excluded. Breaks a tie on cost. */
  totalTokens: number;
  /** True when any day in the period is Quarantined, whatever it is worth. */
  quarantined: boolean;
}

/** One model's tokens over the period, summed over every Builder in scope. */
export interface ModelUsageSnapshot {
  model: string;
  totalTokens: number;
}

/**
 * Everything a Market needs to settle: the Builders it can name (in scope, or
 * exactly the ones its params name) and the models burnt in scope. Both are
 * already free of Quarantined Usage; `quarantined` is what carries the fact.
 */
export interface ResolutionSnapshot {
  builders: readonly BuilderUsageSnapshot[];
  models: readonly ModelUsageSnapshot[];
}

export type MarketResolution =
  | { kind: "win"; winningOutcomeRef: OutcomeRef }
  | { kind: "hold"; reason: string }
  | { kind: "void"; reason: string };

/** Why a held Market is waiting. Shown to traders as it is written here. */
export const QUARANTINE_HOLD_REASON =
  "Usage behind this market is quarantined and under review.";

function win(winningOutcomeRef: OutcomeRef): MarketResolution {
  return { kind: "win", winningOutcomeRef };
}

/**
 * Whether an Outcome covers a measured winner. The escape hatches are the point:
 * `builder_other` covers any Builder it does not exclude, which is how a Market
 * stays answerable after someone joins the Community mid-week.
 */
export function outcomeRefMatches(ref: OutcomeRef, winner: OutcomeRef): boolean {
  switch (ref.kind) {
    case "builder":
      return winner.kind === "builder" && winner.builderId === ref.builderId;
    case "builder_other":
      return winner.kind === "builder" && !ref.excludes.includes(winner.builderId);
    case "model":
      return winner.kind === "model" && winner.model === ref.model;
    case "model_other":
      return winner.kind === "model" && !ref.excludes.includes(winner.model);
    case "threshold_met":
      return winner.kind === "threshold_met";
    case "threshold_missed":
      return winner.kind === "threshold_missed";
  }
}

/** The Builders whose Quarantined Usage would make an answer unsafe, per template. */
function referencedBuilders(
  params: MarketTemplateParams,
  snapshot: ResolutionSnapshot,
): readonly BuilderUsageSnapshot[] {
  switch (params.template) {
    case "threshold":
      return snapshot.builders.filter(
        (builder) => builder.builderId === params.threshold.builderId,
      );
    case "head_to_head": {
      const pair = params.pair.map((builder) => builder.builderId);
      return snapshot.builders.filter((builder) => pair.includes(builder.builderId));
    }
    /*
      Top Burner and Model Race are settled by comparing everyone in scope, so
      every Builder in scope is referenced: a held-back day anywhere could be
      the one that changes the ranking.
    */
    case "top_burner":
    case "model_race":
      return snapshot.builders;
  }
}

/** Cost first, tokens next, handle last, so ranking never depends on row order. */
function byBurn(a: BuilderUsageSnapshot, b: BuilderUsageSnapshot): number {
  if (a.costUsd !== b.costUsd) return b.costUsd - a.costUsd;
  if (a.totalTokens !== b.totalTokens) return b.totalTokens - a.totalTokens;
  return a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0;
}

function resolveTopBurner(snapshot: ResolutionSnapshot): MarketResolution {
  const ranked = snapshot.builders.filter((builder) => builder.costUsd > 0).sort(byBurn);
  const leader = ranked[0];
  if (!leader) return { kind: "void", reason: "Nobody in scope burned anything over the period." };
  return win({ kind: "builder", builderId: leader.builderId });
}

function resolveThreshold(params: ThresholdParams, snapshot: ResolutionSnapshot): MarketResolution {
  /*
    A Builder with no Usage at all is not missing data, it is a Builder who
    burned nothing: the amount was not reached, which is what the rules say.
  */
  const builder = snapshot.builders.find((row) => row.builderId === params.threshold.builderId);
  const cost = builder?.costUsd ?? 0;
  return win(
    cost >= params.threshold.costUsd ? { kind: "threshold_met" } : { kind: "threshold_missed" },
  );
}

function resolveHeadToHead(
  params: HeadToHeadParams,
  snapshot: ResolutionSnapshot,
): MarketResolution {
  const cost = (builderId: string) =>
    snapshot.builders.find((row) => row.builderId === builderId)?.costUsd ?? 0;
  const [first, second] = params.pair;
  const a = cost(first.builderId);
  const b = cost(second.builderId);
  // The published rules sentence says a tie voids it, so it does, zeros included.
  if (a === b) return { kind: "void", reason: "The two builders tied on usage cost." };
  return win({ kind: "builder", builderId: a > b ? first.builderId : second.builderId });
}

function resolveModelRace(params: ModelRaceParams, snapshot: ResolutionSnapshot): MarketResolution {
  const named = new Map(params.models.map((model, index) => [model, index]));
  /*
    Tokens first. A tie goes to the model named earlier in the params, then to
    the lower name, so two models on identical totals settle the same way on
    every run and an unnamed model never takes a tie from a named one.
  */
  const ranked = [...snapshot.models]
    .filter((model) => model.totalTokens > 0)
    .sort((a, b) => {
      if (a.totalTokens !== b.totalTokens) return b.totalTokens - a.totalTokens;
      const rankA = named.get(a.model) ?? params.models.length;
      const rankB = named.get(b.model) ?? params.models.length;
      if (rankA !== rankB) return rankA - rankB;
      return a.model < b.model ? -1 : a.model > b.model ? 1 : 0;
    });

  const leader = ranked[0];
  if (!leader) {
    return { kind: "void", reason: "No model burned any tokens in scope over the period." };
  }
  return win({ kind: "model", model: leader.model });
}

/**
 * Settle one Market from its params and a snapshot of the period it measures.
 *
 * Quarantine is checked before anything is compared: an answer computed while
 * the Usage behind it is under review is worse than no answer.
 */
export function resolveMarket(
  params: MarketTemplateParams,
  snapshot: ResolutionSnapshot,
): MarketResolution {
  if (referencedBuilders(params, snapshot).some((builder) => builder.quarantined)) {
    return { kind: "hold", reason: QUARANTINE_HOLD_REASON };
  }

  switch (params.template) {
    case "top_burner":
      return resolveTopBurner(snapshot);
    case "threshold":
      return resolveThreshold(params, snapshot);
    case "head_to_head":
      return resolveHeadToHead(params, snapshot);
    case "model_race":
      return resolveModelRace(params, snapshot);
  }
}
