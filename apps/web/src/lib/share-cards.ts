/*
  What a share card says, for every route that has one.

  Pure on purpose: a mapper takes the numbers a page already loaded and returns a
  ShareCard, so the wording and the truncation can be tested without rendering a
  PNG. Only og-card.tsx knows how a ShareCard is drawn.
*/
import { METRIC_LABELS, PERIOD_LABELS, type Metric, type Period } from "./leaderboard";

export interface ShareRow {
  label: string;
  value: string;
  /** 0 to 1. Present only where a bar carries meaning, such as an Outcome price. */
  fill?: number;
  /** Prices and forecasts are the one place cyan is allowed (DESIGN.md). */
  tone?: "price" | "plain";
}

export interface ShareCard {
  eyebrow?: string;
  headline: string;
  /** A single word inside the headline painted primary. One per card. */
  accent?: string;
  headlineSize: number;
  subline?: string;
  panelTitle?: string;
  /** Draws the ember dot next to the panel title. Only for numbers that move. */
  live?: boolean;
  rows?: ShareRow[];
  footer: string;
  /** The card's alt text, which is also what a screen reader gets on X. */
  alt: string;
}

/** How many Outcomes a Market card quotes, and how deep a board card goes. */
export const CARD_OUTCOMES = 3;
export const CARD_BOARD_ROWS = 5;

/*
  The pixel face is drawn on a 1200x630 canvas next to a 400px panel, so the
  headline gets roughly 600px of width and three lines. These steps are the
  largest size that keeps a headline of that length inside them.
*/
export function headlineFontSize(text: string): number {
  const length = text.length;
  if (length <= 16) return 96;
  if (length <= 28) return 72;
  if (length <= 48) return 56;
  if (length <= 80) return 44;
  return 36;
}

/** Cuts on a word boundary where there is one, and always keeps the ellipsis inside the limit. */
export function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Burn as money, whole dollars. Cents on a share card are noise. */
export function formatUsd(value: number): string {
  return usd.format(value);
}

const plain = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function formatCount(value: number): string {
  return plain.format(Math.round(value));
}

/** Prices read as cents, the way the Market page quotes them. */
export function formatCents(price: number): string {
  return `${Math.round(price * 100)}¢`;
}

export interface ProfileCardInput {
  handle: string;
  weekCostUsd: number;
  monthCostUsd: number;
  creditBalance: number;
  /** Weakest Trust Level over the Builder's counted days, which is what a badge would say. */
  trust: "verified" | "reported";
}

export function profileCard(input: ProfileCardInput): ShareCard {
  const headline = `@${input.handle}`;
  return {
    eyebrow: `builder · ${input.trust}`,
    headline,
    headlineSize: headlineFontSize(headline),
    subline: `Burns ${formatUsd(input.weekCostUsd)} this week on AI coding agents.`,
    panelTitle: "burn and credits",
    rows: [
      { label: "this week", value: formatUsd(input.weekCostUsd) },
      { label: "this month", value: formatUsd(input.monthCostUsd) },
      { label: "credits", value: formatCount(input.creditBalance) },
    ],
    footer: `tokenburnmarket.com/@${input.handle}`,
    alt: `@${input.handle} burns ${formatUsd(input.weekCostUsd)} this week on tokenburnmarket.`,
  };
}

/** The title a profile carries into a tab and a link preview. */
export function profileTitle(handle: string, weekCostUsd: number): string {
  return `@${handle} burns ${formatUsd(weekCostUsd)} this week`;
}

export interface MarketCardInput {
  question: string;
  /** "global", "community · formidable", "country · RO". */
  scopeLine: string;
  closesLine: string;
  outcomes: readonly { label: string; price: number }[];
}

export function marketCard(input: MarketCardInput): ShareCard {
  const headline = truncate(input.question, 90);
  const top = [...input.outcomes]
    .sort((a, b) => b.price - a.price)
    .slice(0, CARD_OUTCOMES)
    .map((outcome) => ({
      label: truncate(outcome.label, 20),
      value: formatCents(outcome.price),
      fill: outcome.price,
      tone: "price" as const,
    }));

  return {
    eyebrow: input.scopeLine,
    headline,
    headlineSize: headlineFontSize(headline),
    subline: "Play-money prediction market. A winning share pays 1 credit.",
    panelTitle: "prices now",
    live: true,
    rows: top,
    footer: input.closesLine,
    alt: `Market on tokenburnmarket: ${input.question}`,
  };
}

export interface BoardCardInput {
  /** "World", "Europe", a country, or a Community name. */
  name: string;
  period: Period;
  metric: Metric;
  /** Already ranked and already formatted by the board's own formatter. */
  rows: readonly { rank: number; handle: string; value: string }[];
  /** Total of the metric over the rows shown, formatted. Omitted when it would read as zero. */
  total?: string;
  kind: "region" | "community";
}

export function boardCard(input: BoardCardInput): ShareCard {
  const season = PERIOD_LABELS[input.period];
  const headline = truncate(`${input.name} board`, 60);
  const rows = input.rows.slice(0, CARD_BOARD_ROWS).map((row) => ({
    label: `${String(row.rank).padStart(2, "0")} ${truncate(row.handle, 16)}`,
    value: row.value,
  }));

  return {
    eyebrow: `${input.kind === "community" ? "community" : "region"} · ${season}`,
    headline,
    headlineSize: headlineFontSize(headline),
    subline:
      rows.length === 0
        ? "Nobody has burned here yet. Connect a machine and take rank one."
        : `Who burns most ${season}${input.total ? `. ${input.total} between them.` : "."}`,
    panelTitle: `top ${rows.length || CARD_BOARD_ROWS} by ${METRIC_LABELS[input.metric]}`,
    rows,
    footer: `${input.name} · ${season}`,
    alt: `${input.name} leaderboard on tokenburnmarket, ${season}.`,
  };
}

/** The board title a tab and a link preview carry: "Europe board · this week". */
export function boardTitle(name: string, period: Period): string {
  return `${name} board · ${PERIOD_LABELS[period]}`;
}

/** The default card, for the landing page and anything without one of its own. */
export function siteCard(): ShareCard {
  return {
    headline: "Bet your burn.",
    accent: "burn",
    headlineSize: headlineFontSize("Bet your burn."),
    subline: "Your agent usage becomes credits. Credits become bets on who burns what next.",
    panelTitle: "live · this week",
    live: true,
    rows: [
      { label: "@alex", value: "42¢", fill: 0.42, tone: "price" },
      { label: "@theo", value: "31¢", fill: 0.31, tone: "price" },
      { label: "@mira", value: "19¢", fill: 0.19, tone: "price" },
    ],
    footer: "Play money. Real bragging rights.",
    alt: "tokenburnmarket. Bet your burn.",
  };
}
