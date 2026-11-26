/*
  What the landing page shows above the boards: current global model Usage and
  the four numbers under the hero. The Market mapper remains here for other
  compact Market previews.

  Pure on purpose, like the share card mappers: the queries live in
  market-queries.ts and the wording is checked here without a database.
*/
import type { MarketPreviewData } from "@/components/landing/market-preview";
import { formatCredits } from "./credits";
import { formatClosesIn, scopeLabel, type MarketScope } from "./markets";
import { formatCount, formatUsd } from "./share-cards";

export interface FeaturedMarketInput {
  id: string;
  question: string;
  scope: MarketScope;
  communityName: string | null;
  country: string | null;
  closesAt: Date;
  creditsInPlay: number;
  outcomes: readonly { label: string; price: number }[];
}

/** Scope, and the audience's name where there is one. Global Markets have none. */
function whereLine(market: FeaturedMarketInput): string {
  const who =
    market.scope === "community"
      ? market.communityName
      : market.scope === "country"
        ? market.country
        : null;
  return who ? `${scopeLabel(market.scope)} · ${who}` : scopeLabel(market.scope);
}

export function marketPreviewData(
  market: FeaturedMarketInput,
  now: Date = new Date(),
): MarketPreviewData {
  return {
    href: `/m/${market.id}`,
    where: whereLine(market),
    question: market.question,
    inPlay: `${formatCredits(market.creditsInPlay)} cr in play`,
    closes: formatClosesIn(market.closesAt, now),
    outcomes: market.outcomes.map((outcome) => ({ label: outcome.label, price: outcome.price })),
  };
}

export interface ModelBurnDayInput {
  day: string;
  model: string;
  tokens: number;
}

export interface ModelBurnLine {
  /** The model as Usage names it. Unique, unlike `label`: two ids can read the same. */
  model: string;
  label: string;
  /** Running total of tokens at the end of each day in `days`. */
  cumulative: readonly number[];
  /** The same running totals, formatted, so the chart needs no formatter. */
  values: readonly string[];
}

export interface ModelBurnChartData {
  live: boolean;
  /** Every model in the Season, not only the lines drawn, such as "924.5M tokens". */
  total: string;
  /** The Season the chart covers, in the words the Leaderboards use: "this month". */
  season: string;
  /** Consecutive UTC days, from the first day with Usage to today. */
  days: readonly string[];
  /** The value at the top of the chart, a little above the leader. */
  top: number;
  ticks: readonly { value: number; label: string }[];
  /** The leaders, first place first. */
  lines: readonly ModelBurnLine[];
}

export const MODEL_BURN_LINES = 5;

const compactTokens = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function modelLabel(model: string): string {
  const [family, ...rest] = model.split("-");
  const words = rest.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`);
  if (family.toLowerCase() === "gpt") return `GPT-${words.join(" ")}`;
  const name = `${family.charAt(0).toUpperCase()}${family.slice(1)}`;
  return [name, ...words].join(" ");
}

function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** The largest of 1, 2 or 5 times a power of ten that is not above `value`. */
function roundStep(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const lead = value / magnitude;
  return (lead >= 5 ? 5 : lead >= 2 ? 2 : 1) * magnitude;
}

/**
 * The landing hero chart: a running total of tokens per model over one Season.
 * A Market on who burns most settles on a total, so the chart shows the lead
 * and the gap between models. It does not show which day was the largest.
 */
export function modelBurnChartData(
  rows: readonly ModelBurnDayInput[],
  today: string,
  season: string,
): ModelBurnChartData {
  const burnt = rows.filter((row) => row.tokens > 0 && row.day <= today);
  if (burnt.length === 0) {
    return { live: false, total: "0 tokens", season, days: [], top: 0, ticks: [], lines: [] };
  }

  const days: string[] = [];
  const first = burnt.reduce((earliest, row) => (row.day < earliest ? row.day : earliest), today);
  for (let day = first; day <= today; day = nextDay(day)) days.push(day);

  const byModel = new Map<string, Map<string, number>>();
  for (const row of burnt) {
    const perDay = byModel.get(row.model) ?? new Map<string, number>();
    perDay.set(row.day, (perDay.get(row.day) ?? 0) + row.tokens);
    byModel.set(row.model, perDay);
  }

  const totals = [...byModel].map(([model, perDay]) => {
    let running = 0;
    const cumulative = days.map((day) => (running += perDay.get(day) ?? 0));
    return { model, cumulative, total: running };
  });
  // Ties break on the name, so two reloads never draw two different orders.
  totals.sort((a, b) => b.total - a.total || a.model.localeCompare(b.model));

  const leaders = totals.slice(0, MODEL_BURN_LINES);
  const peak = leaders[0]!.total;
  const step = roundStep(peak / 2);
  const ticks = [];
  for (let value = step; value <= peak; value += step) {
    ticks.push({ value, label: compactTokens.format(value) });
  }

  return {
    live: true,
    total: `${compactTokens.format(totals.reduce((sum, row) => sum + row.total, 0))} tokens`,
    season,
    days,
    top: peak * 1.08,
    ticks,
    lines: leaders.map((row) => ({
      model: row.model,
      label: modelLabel(row.model),
      cumulative: row.cumulative,
      values: row.cumulative.map((value) => compactTokens.format(value)),
    })),
  };
}

export interface StatCell {
  label: string;
  value: string;
}

export interface SiteStatsInput {
  buildersConnected: number;
  weekCostUsd: number;
  openMarkets: number;
  creditsInPlay: number;
}

/*
  The stats strip. Every cell has a word next to its number, and a zero is shown
  as a zero: an empty site that pretends to be busy is the one thing this page
  cannot do.
*/
export function statCells(stats: SiteStatsInput): StatCell[] {
  return [
    { label: "builders connected", value: formatCount(stats.buildersConnected) },
    { label: "burn this week", value: formatUsd(stats.weekCostUsd) },
    { label: "open markets", value: formatCount(stats.openMarkets) },
    { label: "credits in play", value: formatCount(stats.creditsInPlay) },
  ];
}
