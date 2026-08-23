/*
  Turning a template into the rows a Market is made of. The template rules live
  in core; what lives here is everything the web app adds on top: which weeks a
  form may pick, how liquidity is sized from the audience, and the shape the
  creation action and the automatic job both insert.

  No database here, so a plan can be asserted without one.
*/
import {
  MODEL_RACE_MODELS,
  buildTemplateOutcomes,
  lmsrLiquidityForAudience,
  lmsrLiquidityForMembers,
  marketTemplateQuestion,
  nextUtcWeek,
  periodClosesAt,
  utcWeekOf,
  type MarketPeriod,
  type MarketTemplateParams,
  type MemberSnapshot,
  type TemplateOutcome,
} from "@tokenburnmarket/core";
import type { MarketParams } from "@/db/schema";
import { MIN_OPEN_MINUTES, resolutionTimeFor, type MarketScope, type Normalized } from "./markets";

/** The weeks a form may point a Market at. Nothing older, nothing further out. */
export const PERIOD_CHOICES = ["this_week", "next_week"] as const;
export type PeriodChoice = (typeof PERIOD_CHOICES)[number];

export const PERIOD_CHOICE_LABELS: Record<PeriodChoice, string> = {
  this_week: "this week",
  next_week: "next week",
};

export function normalizePeriodChoice(input: string | null | undefined): PeriodChoice {
  return input === "next_week" ? "next_week" : "this_week";
}

export function periodForChoice(choice: PeriodChoice, now: Date): MarketPeriod {
  return choice === "next_week" ? nextUtcWeek(now) : utcWeekOf(now);
}

/*
  The models a Model Race runs on, in current usage order. Outcomes are facts
  about this Market, so an unobserved model must never be invented as fallback.
*/
export function raceModels(observed: readonly string[]): string[] {
  return [...new Set(observed)].slice(0, MODEL_RACE_MODELS);
}

/** What the picker shows, in the order it shows it. */
export interface TemplateCard {
  template: MarketTemplateParams["template"];
  title: string;
  blurb: string;
  /** True when only an admin may open it, because its scope is bigger than a Community. */
  adminOnly: boolean;
}

export const TEMPLATE_CARDS: readonly TemplateCard[] = [
  {
    template: "top_burner",
    title: "Top Burner",
    blurb: "Who in the community burns the most over a week. Everyone gets a price.",
    adminOnly: false,
  },
  {
    template: "threshold",
    title: "Threshold",
    blurb: "Does one member reach an amount of usage cost. Two outcomes, yes and no.",
    adminOnly: false,
  },
  {
    template: "head_to_head",
    title: "Head-to-Head",
    blurb: "Two members, one week, whoever burns more. A tie voids it.",
    adminOnly: false,
  },
  {
    template: "model_race",
    title: "Model Race",
    blurb: "Which model burns the most tokens, globally or in one country. Admins only.",
    adminOnly: true,
  },
];

/** Everything an insert needs, and nothing a caller has to decide twice. */
export interface MarketPlan {
  scope: MarketScope;
  communityId: string | null;
  country: string | null;
  type: MarketTemplateParams["template"];
  question: string;
  params: MarketParams;
  b: number;
  closesAt: Date;
  resolvesAt: Date;
  outcomes: TemplateOutcome[];
  /** Set only by the automatic job, which makes a repeat run a no-op. */
  autoKey: string | null;
}

export interface PlanInput {
  params: MarketTemplateParams;
  /** Ranked members, for the one template whose Outcomes are not named in its params. */
  members?: readonly MemberSnapshot[];
  /** How many people can trade it: Community members, or Builders in the wider scope. */
  audience: number;
  autoKey?: string | null;
}

/*
  Liquidity is fixed at creation from the size of the audience (ADR 0002) and
  never moves: changing `b` would reprice every Position already held. A
  Community is sized by its members, a wider scope starts deeper and is capped.
*/
export function liquidityFor(scope: MarketScope, audience: number): number {
  return scope === "community" ? lmsrLiquidityForMembers(audience) : lmsrLiquidityForAudience(audience);
}

function scopeOf(params: MarketTemplateParams): MarketScope {
  return params.scope.kind;
}

/**
 * The Market a template describes: question, Outcomes, liquidity and the two
 * timestamps. Trading closes when the measured period does, and Usage is read a
 * day later so a late Sync still counts.
 */
export function planTemplateMarket(
  input: PlanInput,
  now: Date = new Date(),
): Normalized<MarketPlan> {
  const { params } = input;
  const closesAt = periodClosesAt(params.period);

  if (closesAt.getTime() - now.getTime() < MIN_OPEN_MINUTES * 60_000) {
    return { ok: false, error: "That period is over. Pick the next one." };
  }

  let outcomes: TemplateOutcome[];
  try {
    outcomes = buildTemplateOutcomes(params, input.members ?? []);
  } catch {
    return { ok: false, error: "There is nobody to put on the board yet." };
  }

  const scope = scopeOf(params);
  return {
    ok: true,
    value: {
      scope,
      communityId: params.scope.kind === "community" ? params.scope.communityId : null,
      country: params.scope.kind === "country" ? params.scope.country : null,
      type: params.template,
      question: marketTemplateQuestion(params),
      params: params as unknown as MarketParams,
      b: liquidityFor(scope, input.audience),
      closesAt,
      resolvesAt: resolutionTimeFor(closesAt),
      outcomes,
      autoKey: input.autoKey ?? null,
    },
  };
}
