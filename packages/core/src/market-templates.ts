// Market templates: the four questions tokenburnmarket knows how to ask
// (CONTEXT.md), as parameters a resolver can settle without asking anything else.
//
// A template is three pure things: a zod schema for its `params`, an Outcome
// builder that turns a snapshot of members or models into the rows people
// trade, and the rules sentence shown under the question. Nothing here reads a
// database or a clock it was not handed.
//
// The params are deliberately self-contained: a resolver gets the measured
// period, the scope it applies to, and the Builders or models named in it, so
// settling a Market is a function of `params` plus Usage over the period.

import { z } from "zod";
import { UtcDaySchema } from "./sync";

export const MARKET_TEMPLATES = ["top_burner", "threshold", "head_to_head", "model_race"] as const;
export type MarketTemplate = (typeof MARKET_TEMPLATES)[number];

/** A Market carries at most this many Outcomes, escape hatch included. */
export const MAX_TEMPLATE_OUTCOMES = 8;

/** How many models a Model Race names before the rest fall under "another model". */
export const MODEL_RACE_MODELS = MAX_TEMPLATE_OUTCOMES - 1;

/*
  The models a Model Race falls back on before there is enough Usage to rank
  any. Ordered as a reader would expect to see them, not as a prediction.
*/
export const KNOWN_MODELS: readonly string[] = [
  "claude-opus-4",
  "claude-sonnet-4",
  "gpt-5",
  "gpt-5-mini",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "grok-4",
];

const DAY_MS = 86_400_000;

/** A measured stretch of UTC days, both ends inclusive. */
export const MarketPeriodSchema = z
  .object({ start: UtcDaySchema, end: UtcDaySchema })
  .strict()
  .refine((period) => period.end >= period.start, "a period cannot end before it starts");

export type MarketPeriod = z.infer<typeof MarketPeriodSchema>;

/*
  Who the Market is for. The display names travel with the params so the rules
  sentence stays pure: rendering a Market never needs a second query.
*/
export const TemplateScopeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("community"),
      communityId: z.uuid(),
      communityName: z.string().min(1).max(60),
    })
    .strict(),
  z
    .object({
      kind: z.literal("country"),
      country: z.string().regex(/^[A-Z]{2}$/, "expected an ISO alpha-2 country code"),
      countryName: z.string().min(1).max(60),
    })
    .strict(),
  z.object({ kind: z.literal("global") }).strict(),
]);

export type TemplateScope = z.infer<typeof TemplateScopeSchema>;

/** A Builder named in a Market, with the handle the rules sentence reads out. */
export const TemplateBuilderSchema = z
  .object({ builderId: z.uuid(), handle: z.string().min(1).max(39) })
  .strict();

export type TemplateBuilder = z.infer<typeof TemplateBuilderSchema>;

const ModelNameSchema = z.string().min(1).max(128);

const base = { scope: TemplateScopeSchema, period: MarketPeriodSchema };

export const TopBurnerParamsSchema = z
  .object({ template: z.literal("top_burner"), ...base })
  .strict();

export const ThresholdParamsSchema = z
  .object({
    template: z.literal("threshold"),
    ...base,
    threshold: TemplateBuilderSchema.extend({
      /** What the Builder's Usage cost over the period is compared against, in USD. */
      costUsd: z.number().positive().max(1_000_000).finite(),
    }).strict(),
  })
  .strict();

export const HeadToHeadParamsSchema = z
  .object({
    template: z.literal("head_to_head"),
    ...base,
    pair: z
      .tuple([TemplateBuilderSchema, TemplateBuilderSchema])
      .refine(([a, b]) => a.builderId !== b.builderId, "a builder cannot race themselves"),
  })
  .strict();

export const ModelRaceParamsSchema = z
  .object({
    template: z.literal("model_race"),
    ...base,
    models: z
      .array(ModelNameSchema)
      .min(2)
      .max(MODEL_RACE_MODELS)
      .refine((models) => new Set(models).size === models.length, "two outcomes name one model"),
  })
  .strict();

export const MarketTemplateParamsSchema = z.discriminatedUnion("template", [
  TopBurnerParamsSchema,
  ThresholdParamsSchema,
  HeadToHeadParamsSchema,
  ModelRaceParamsSchema,
]);

export type TopBurnerParams = z.infer<typeof TopBurnerParamsSchema>;
export type ThresholdParams = z.infer<typeof ThresholdParamsSchema>;
export type HeadToHeadParams = z.infer<typeof HeadToHeadParamsSchema>;
export type ModelRaceParams = z.infer<typeof ModelRaceParamsSchema>;
export type MarketTemplateParams = z.infer<typeof MarketTemplateParamsSchema>;

/** Reads stored params back as a template, or null when they are not one. */
export function parseTemplateParams(params: unknown): MarketTemplateParams | null {
  const parsed = MarketTemplateParamsSchema.safeParse(params);
  return parsed.success ? parsed.data : null;
}

/*
  What an Outcome points at, for the resolver. `builder_other` and `model_other`
  are the escape hatches: they win when the winner is not one of the named rows,
  which is what keeps a Market answerable after someone joins late.
*/
export type OutcomeRef =
  | { kind: "builder"; builderId: string }
  | { kind: "builder_other"; excludes: string[] }
  | { kind: "model"; model: string }
  | { kind: "model_other"; excludes: string[] }
  | { kind: "threshold_met" }
  | { kind: "threshold_missed" };

const OutcomeRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("builder"), builderId: z.string() }).strict(),
  z.object({ kind: z.literal("builder_other"), excludes: z.array(z.string()) }).strict(),
  z.object({ kind: z.literal("model"), model: z.string() }).strict(),
  z.object({ kind: z.literal("model_other"), excludes: z.array(z.string()) }).strict(),
  z.object({ kind: z.literal("threshold_met") }).strict(),
  z.object({ kind: z.literal("threshold_missed") }).strict(),
]);

/** Reads a stored Outcome `ref` back, or null when it is not one a resolver knows. */
export function parseOutcomeRef(ref: unknown): OutcomeRef | null {
  const parsed = OutcomeRefSchema.safeParse(ref);
  return parsed.success ? parsed.data : null;
}

export interface TemplateOutcome {
  label: string;
  ref: OutcomeRef;
  /** Display order, which is also the order the LMSR sees the shares vector in. */
  sort: number;
}

/** The members a Community Market is built from, most likely to win first. */
export interface MemberSnapshot {
  builderId: string;
  handle: string;
}

/** The label every Top Burner ends on, so a late joiner is still covered. */
export const SOMEONE_ELSE_LABEL = "someone else";
export const ANOTHER_MODEL_LABEL = "another model";

function handleLabel(handle: string): string {
  return `@${handle}`;
}

/*
  Amounts read as a person would write them: whole dollars stay whole, cents
  appear only when they are there. Used in labels, questions and rules alike.
*/
export function formatUsd(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(day: string): { d: number; m: number; y: number } {
  const [y, m, d] = day.split("-").map(Number);
  return { d, m, y };
}

/** One day, spelled out: `17 Aug 2026`. Formatted here so tests do not depend on ICU. */
export function formatDay(day: string): string {
  const { d, m, y } = parts(day);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** A period at question length: `17-23 Aug 2026`, collapsing what both ends share. */
export function formatPeriodShort(period: MarketPeriod): string {
  const from = parts(period.start);
  const to = parts(period.end);
  if (period.start === period.end) return formatDay(period.start);
  if (from.y === to.y && from.m === to.m) {
    return `${from.d}-${to.d} ${MONTHS[to.m - 1]} ${to.y}`;
  }
  if (from.y === to.y) {
    return `${from.d} ${MONTHS[from.m - 1]} to ${to.d} ${MONTHS[to.m - 1]} ${to.y}`;
  }
  return `${formatDay(period.start)} to ${formatDay(period.end)}`;
}

/** Where the Market applies, as a phrase that can follow a verb. */
function scopePhrase(scope: TemplateScope): string {
  if (scope.kind === "community") return `in ${scope.communityName}`;
  if (scope.kind === "country") return `in ${scope.countryName}`;
  return "anywhere";
}

/*
  Dedupes a snapshot and keeps the caller's order: the caller ranks members, so
  truncating at the cap drops the least likely winners rather than a random few.
*/
function distinctMembers(members: readonly MemberSnapshot[]): MemberSnapshot[] {
  const seen = new Set<string>();
  const kept: MemberSnapshot[] = [];
  for (const member of members) {
    if (seen.has(member.builderId)) continue;
    seen.add(member.builderId);
    kept.push(member);
  }
  return kept;
}

/**
 * The Outcomes of a Top Burner: the members named, then "someone else" for
 * everyone who is not. The escape hatch is unconditional, so a Community that
 * gains a member mid-week still has a row that can win.
 */
export function buildTopBurnerOutcomes(members: readonly MemberSnapshot[]): TemplateOutcome[] {
  const named = distinctMembers(members).slice(0, MAX_TEMPLATE_OUTCOMES - 1);
  if (named.length === 0) throw new RangeError("a top burner needs at least one member");

  const rows: TemplateOutcome[] = named.map((member, sort) => ({
    label: handleLabel(member.handle),
    ref: { kind: "builder", builderId: member.builderId },
    sort,
  }));
  rows.push({
    label: SOMEONE_ELSE_LABEL,
    ref: { kind: "builder_other", excludes: named.map((member) => member.builderId) },
    sort: rows.length,
  });
  return rows;
}

/** The two sides of a Threshold: the amount is reached, or it is not. */
export function buildThresholdOutcomes(params: ThresholdParams): TemplateOutcome[] {
  const amount = formatUsd(params.threshold.costUsd);
  return [
    { label: `${amount} or more`, ref: { kind: "threshold_met" }, sort: 0 },
    { label: `under ${amount}`, ref: { kind: "threshold_missed" }, sort: 1 },
  ];
}

/** The two Builders of a Head-to-Head, in the order they were named. */
export function buildHeadToHeadOutcomes(params: HeadToHeadParams): TemplateOutcome[] {
  return params.pair.map((builder, sort) => ({
    label: handleLabel(builder.handle),
    ref: { kind: "builder", builderId: builder.builderId } as OutcomeRef,
    sort,
  }));
}

/** The models of a Model Race, plus the row that covers everything unnamed. */
export function buildModelRaceOutcomes(params: ModelRaceParams): TemplateOutcome[] {
  const rows: TemplateOutcome[] = params.models.map((model, sort) => ({
    label: model,
    ref: { kind: "model", model } as OutcomeRef,
    sort,
  }));
  rows.push({
    label: ANOTHER_MODEL_LABEL,
    ref: { kind: "model_other", excludes: [...params.models] },
    sort: rows.length,
  });
  return rows;
}

/**
 * The Outcomes for any template. `members` is only read by Top Burner, which is
 * the one template whose rows are not already named in its params.
 */
export function buildTemplateOutcomes(
  params: MarketTemplateParams,
  members: readonly MemberSnapshot[] = [],
): TemplateOutcome[] {
  switch (params.template) {
    case "top_burner":
      return buildTopBurnerOutcomes(members);
    case "threshold":
      return buildThresholdOutcomes(params);
    case "head_to_head":
      return buildHeadToHeadOutcomes(params);
    case "model_race":
      return buildModelRaceOutcomes(params);
  }
}

/** The question at the top of the Market page. Short enough to read in one go. */
export function marketTemplateQuestion(params: MarketTemplateParams): string {
  const when = formatPeriodShort(params.period);
  switch (params.template) {
    case "top_burner":
      return `Who burns most ${scopePhrase(params.scope)}, ${when}?`;
    case "threshold":
      return `Does ${handleLabel(params.threshold.handle)} burn ${formatUsd(
        params.threshold.costUsd,
      )} or more, ${when}?`;
    case "head_to_head":
      return `Does ${handleLabel(params.pair[0].handle)} out-burn ${handleLabel(
        params.pair[1].handle,
      )}, ${when}?`;
    case "model_race":
      return `Which model burns most ${scopePhrase(params.scope)}, ${when}?`;
  }
}

/*
  The rules sentence under the question: what is measured, over which days, and
  what settles it. Derived rather than stored, so every Market says the same
  thing in the same words even after the wording changes.
*/
export function marketTemplateRulesText(params: MarketTemplateParams): string {
  const days = `Usage from ${formatDay(params.period.start)} to ${formatDay(params.period.end)} UTC decides it.`;
  const pays = "A winning share pays 1 credit.";

  switch (params.template) {
    case "top_burner":
      return `The member ${scopePhrase(params.scope)} with the highest usage cost over the period wins. Someone else wins if the top burner is not one of the named members, which covers anyone who joins late. ${days} ${pays}`;
    case "threshold":
      return `${handleLabel(params.threshold.handle)} reaching ${formatUsd(
        params.threshold.costUsd,
      )} of usage cost over the period settles this yes. Anything under it settles no. ${days} ${pays}`;
    case "head_to_head":
      return `${handleLabel(params.pair[0].handle)} and ${handleLabel(
        params.pair[1].handle,
      )} are compared on usage cost over the period. The higher one wins, and a tie voids the market. ${days} ${pays}`;
    case "model_race":
      return `The model with the most tokens ${scopePhrase(
        params.scope,
      )} over the period wins, counted across every builder in scope. Another model wins if it is none of the named ones. ${days} ${pays}`;
  }
}

/** Midnight UTC of the day `day` names, in epoch milliseconds. */
function dayStart(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

function toDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The Monday-to-Sunday UTC week containing `now`. Weeks are the unit both the
 * auto-created Markets and the week Season are cut on, so they line up.
 */
export function utcWeekOf(now: Date): MarketPeriod {
  const today = dayStart(now.toISOString().slice(0, 10));
  // getUTCDay is Sunday-first; a week is Monday-first.
  const monday = today - ((new Date(today).getUTCDay() + 6) % 7) * DAY_MS;
  return { start: toDay(monday), end: toDay(monday + 6 * DAY_MS) };
}

/** The week after the one containing `now`. */
export function nextUtcWeek(now: Date): MarketPeriod {
  const current = utcWeekOf(now);
  const monday = dayStart(current.start) + 7 * DAY_MS;
  return { start: toDay(monday), end: toDay(monday + 6 * DAY_MS) };
}

/**
 * When trading stops: midnight UTC after the last measured day. Usage inside
 * the period is still arriving until then, which is the point of trading it.
 */
export function periodClosesAt(period: MarketPeriod): Date {
  return new Date(dayStart(period.end) + DAY_MS);
}

/**
 * The key that makes auto-creation idempotent: one Market per template, scope
 * and week, whatever happens to the cron in between.
 */
export function autoMarketKey(
  template: MarketTemplate,
  scopeKey: string,
  period: MarketPeriod,
): string {
  return `${template}:${scopeKey}:${period.start}`;
}
