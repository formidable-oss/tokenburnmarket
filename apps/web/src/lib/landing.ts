/*
  What the landing page shows above the boards: the busiest open Market, and the
  four numbers under the hero.

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
