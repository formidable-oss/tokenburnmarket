/*
  Pure rules for Markets: what a person may type into the creation form, how a
  Market reads on screen, and how its rules sentence is built. No database here,
  so every rule below is unit tested.
*/
import { marketTemplateRulesText, parseTemplateParams } from "@tokenburnmarket/core";
import type { MarketParams, marketScope, marketStatus, marketType } from "@/db/schema";

export type MarketScope = (typeof marketScope.enumValues)[number];
export type MarketStatus = (typeof marketStatus.enumValues)[number];
export type MarketType = (typeof marketType.enumValues)[number];

export type Normalized<T> = { ok: true; value: T } | { ok: false; error: string };

export const QUESTION_MAX = 140;
export const OUTCOME_LABEL_MAX = 60;
export const MIN_OUTCOMES = 2;
export const MAX_OUTCOMES = 8;

/** A Market has to stay open long enough to be worth pricing, and end this century. */
export const MIN_OPEN_MINUTES = 10;
export const MAX_OPEN_DAYS = 180;

/** How long after close Usage is read, so a late Sync still counts. ADR 0003 buffer. */
export const RESOLUTION_BUFFER_HOURS = 24;

export function normalizeQuestion(input: string | null | undefined): Normalized<string> {
  const question = (input ?? "").trim().replace(/\s+/g, " ");
  if (question === "") return { ok: false, error: "Ask a question." };
  if (question.length < 8) return { ok: false, error: "Say a bit more than that." };
  if (question.length > QUESTION_MAX) {
    return { ok: false, error: `Up to ${QUESTION_MAX} characters.` };
  }
  return { ok: true, value: question };
}

/*
  Outcome labels are the answers people trade, so blanks are dropped rather than
  rejected: an eight-slot form left half empty is a four-outcome Market, not a
  mistake. Duplicates are rejected, because two identical rows on the page would
  be two different prices for the same answer.
*/
export function normalizeOutcomeLabels(inputs: readonly (string | null | undefined)[]): Normalized<
  string[]
> {
  const labels = inputs
    .map((input) => (input ?? "").trim().replace(/\s+/g, " "))
    .filter((label) => label !== "");

  if (labels.length < MIN_OUTCOMES) return { ok: false, error: `Give at least ${MIN_OUTCOMES} outcomes.` };
  if (labels.length > MAX_OUTCOMES) return { ok: false, error: `Up to ${MAX_OUTCOMES} outcomes.` };
  if (labels.some((label) => label.length > OUTCOME_LABEL_MAX)) {
    return { ok: false, error: `Each outcome is up to ${OUTCOME_LABEL_MAX} characters.` };
  }
  const seen = new Set(labels.map((label) => label.toLowerCase()));
  if (seen.size !== labels.length) return { ok: false, error: "Two outcomes say the same thing." };
  return { ok: true, value: labels };
}

/** Parses the `datetime-local` value the form sends, which carries no zone, as UTC. */
export function normalizeClosesAt(
  input: string | null | undefined,
  now: Date = new Date(),
): Normalized<Date> {
  const raw = (input ?? "").trim();
  if (raw === "") return { ok: false, error: "Pick a closing time." };
  const closesAt = new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw}Z`);
  if (Number.isNaN(closesAt.getTime())) return { ok: false, error: "That is not a time." };

  const minutes = (closesAt.getTime() - now.getTime()) / 60_000;
  if (minutes < MIN_OPEN_MINUTES) {
    return { ok: false, error: `Leave at least ${MIN_OPEN_MINUTES} minutes of trading.` };
  }
  if (minutes > MAX_OPEN_DAYS * 24 * 60) {
    return { ok: false, error: `Close within ${MAX_OPEN_DAYS} days.` };
  }
  return { ok: true, value: closesAt };
}

/** Usage is read a day after close, so a Sync that arrives late still counts. */
export function resolutionTimeFor(closesAt: Date): Date {
  return new Date(closesAt.getTime() + RESOLUTION_BUFFER_HOURS * 3_600_000);
}

/** Shares traded, as typed. Fractional shares are allowed; the AMM prices them fine. */
export const MAX_TRADE_SHARES = 100_000;

export function normalizeShareAmount(input: string | number | null | undefined): Normalized<number> {
  const shares = typeof input === "number" ? input : Number((input ?? "").toString().trim());
  if (!Number.isFinite(shares)) return { ok: false, error: "Enter a number of shares." };
  // Positions store four decimals, so anything finer would round away on write.
  const rounded = Math.round(shares * 10_000) / 10_000;
  if (rounded <= 0) return { ok: false, error: "Trade at least 0.0001 shares." };
  if (rounded > MAX_TRADE_SHARES) return { ok: false, error: "That is too many shares." };
  return { ok: true, value: rounded };
}

/** Prices read as cents, the way a prediction market is quoted. Always two digits. */
export function formatPriceCents(price: number): string {
  return `${(price * 100).toFixed(1)}¢`;
}

/** The same price as a probability, for the bar label. */
export function formatProbability(price: number): string {
  return `${Math.round(price * 100)}%`;
}

const SCOPE_LABELS: Record<MarketScope, string> = {
  community: "community",
  country: "country",
  global: "global",
};

export function scopeLabel(scope: MarketScope): string {
  return SCOPE_LABELS[scope];
}

const STATUS_LABELS: Record<MarketStatus, string> = {
  open: "open",
  closed: "closed",
  resolved: "resolved",
  voided: "voided",
};

export function statusLabel(status: MarketStatus): string {
  return STATUS_LABELS[status];
}

/** Whether a Market takes trades right now: open, and not yet past its close. */
export function isTradable(
  status: MarketStatus,
  closesAt: Date,
  now: Date = new Date(),
): boolean {
  return status === "open" && closesAt.getTime() > now.getTime();
}

/*
  Time left, at the coarsest useful precision: days while there are days, hours
  while there are hours, then minutes. Past the close it says so rather than
  counting up, because a negative countdown reads as a bug.
*/
export function formatClosesIn(closesAt: Date, now: Date = new Date()): string {
  const ms = closesAt.getTime() - now.getTime();
  if (ms <= 0) return "closed";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `closes in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `closes in ${hours}h`;
  return `closes in ${Math.floor(hours / 24)}d`;
}

/** The settlement time, spelled out the way the rest of the site spells times. */
export function formatResolvesAt(resolvesAt: Date): string {
  return `${new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(resolvesAt)} UTC`;
}

/*
  The rules sentence under the question. Derived from the template's params, so
  every Market of a template says the same thing in the same words. Markets
  opened before templates existed fall back to the sentence stored with them.
*/
export function marketRulesText(params: MarketParams, resolvesAt: Date): string {
  const template = parseTemplateParams(params);
  if (template) return marketTemplateRulesText(template);
  if (typeof params.rules === "string" && params.rules.trim() !== "") return params.rules.trim();

  const stamp = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(resolvesAt);

  const period =
    params.periodStart && params.periodEnd
      ? `Usage from ${params.periodStart} to ${params.periodEnd} decides it. `
      : "";
  return `${period}Settled from Usage at ${stamp} UTC. A winning share pays 1 credit.`;
}
