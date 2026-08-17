/*
  Settling Markets: the decisions, against a small store interface so they are
  testable without a database, the same shape the mint and the weekly job use.

  The cron does three things in order, and each is safe to repeat:

  1. Close every Market past its close time. A closed Market takes no trades.
  2. Settle every closed Market past its resolve time (period end plus a day,
     so a late Sync still counts) from the Usage of the period.
  3. Pay 1 Credit per winning share, or refund cost basis when the Market voids.

  Quarantined Usage is what makes this more than a query. A Market whose answer
  depends on Usage under review is held for a day rather than answered wrong,
  and if the review has not cleared by then the Market is voided and everyone
  gets back exactly what they paid.
*/
import {
  outcomeRefMatches,
  parseOutcomeRef,
  parseTemplateParams,
  resolveMarket,
  roundCredits,
  type MarketTemplateParams,
  type ResolutionSnapshot,
} from "@tokenburnmarket/core";
import type { MarketParams } from "@/db/schema";

/** How long a Market waits for a quarantine review before it is voided. */
export const RESOLUTION_HOLD_HOURS = 24;

/** What a voided Market says when the review never cleared. */
export const HOLD_EXPIRED_REASON =
  "The quarantined usage behind this market did not clear in time.";

/** The one ledger ref a Market ever writes, which is what makes settling idempotent. */
export function marketRef(marketId: string): string {
  return `market:${marketId}`;
}

/** A Market as the resolver reads it, with its book. */
export interface ResolvableMarket {
  id: string;
  params: MarketParams;
  /** Set by an earlier held run; null the first time this Market is settled. */
  holdUntil: Date | null;
  outcomes: readonly { id: string; ref: unknown }[];
}

/** A Position as settlement reads it. Shares are never negative. */
export interface SettlementPosition {
  builderId: string;
  outcomeId: string;
  shares: number;
  costBasis: number;
}

/** One Credit movement a settlement owes a Builder. Always positive. */
export interface CreditWrite {
  builderId: string;
  credits: number;
}

export type ResolutionAction =
  | { kind: "resolve"; winningOutcomeId: string }
  | { kind: "hold"; until: Date; reason: string }
  | { kind: "void"; reason: string }
  /** Nothing this job can settle: a Market opened before templates existed. */
  | { kind: "skip"; reason: string };

/** Sums one Credit amount per Builder, dropping anyone owed nothing. */
function totalPerBuilder(
  positions: readonly SettlementPosition[],
  amount: (position: SettlementPosition) => number,
): CreditWrite[] {
  const totals = new Map<string, number>();
  for (const position of positions) {
    const credits = amount(position);
    if (credits <= 0) continue;
    totals.set(position.builderId, (totals.get(position.builderId) ?? 0) + credits);
  }
  return [...totals]
    .map(([builderId, credits]) => ({ builderId, credits: roundCredits(credits) }))
    .filter((write) => write.credits > 0);
}

/** A winning share pays 1 Credit, and nothing else pays anything. */
export function planPayouts(
  positions: readonly SettlementPosition[],
  winningOutcomeId: string,
): CreditWrite[] {
  return totalPerBuilder(positions, (position) =>
    position.outcomeId === winningOutcomeId ? position.shares : 0,
  );
}

/** A voided Market returns cost basis, which is exactly what was paid in. */
export function planRefunds(positions: readonly SettlementPosition[]): CreditWrite[] {
  return totalPerBuilder(positions, (position) => position.costBasis);
}

/**
 * What to do with one due Market, given the Usage of its period.
 *
 * A hold is entered once and remembered on the Market: the second run to find
 * the same quarantine still unresolved is the one that voids it, which is what
 * turns "wait a day" into a decision the job does not have to hold in memory.
 */
export function planResolution(
  market: ResolvableMarket,
  snapshot: ResolutionSnapshot,
  now: Date,
): ResolutionAction {
  const params: MarketTemplateParams | null = parseTemplateParams(market.params);
  if (!params) return { kind: "skip", reason: "This market was not opened from a template." };

  const resolution = resolveMarket(params, snapshot);

  if (resolution.kind === "hold") {
    if (market.holdUntil && now.getTime() >= market.holdUntil.getTime()) {
      return { kind: "void", reason: HOLD_EXPIRED_REASON };
    }
    const until =
      market.holdUntil ?? new Date(now.getTime() + RESOLUTION_HOLD_HOURS * 3_600_000);
    return { kind: "hold", until, reason: resolution.reason };
  }

  if (resolution.kind === "void") return resolution;

  const winner = market.outcomes.find((outcome) => {
    const ref = parseOutcomeRef(outcome.ref);
    return ref ? outcomeRefMatches(ref, resolution.winningOutcomeRef) : false;
  });
  /*
    Every template ends on a row that covers the unnamed, so this is a book that
    was written by hand or by an older version of a template. Voiding refunds at
    cost, which is the only honest answer when no outcome can be paid.
  */
  if (!winner) return { kind: "void", reason: "No outcome on this market covers the result." };

  return { kind: "resolve", winningOutcomeId: winner.id };
}

/** What one settlement moved. Zero Credits is normal: nobody has to have traded. */
export interface SettlementResult {
  builders: number;
  credits: number;
}

export interface ResolutionStore {
  /** Marks every open Market past its close time closed. Returns how many moved. */
  closeExpired(now: Date): Promise<number>;
  /** Closed Markets due to settle, held ones included. */
  dueForResolution(now: Date): Promise<ResolvableMarket[]>;
  /** Usage over the Market's period, scoped to the audience its params name. */
  snapshotFor(market: ResolvableMarket): Promise<ResolutionSnapshot>;
  /**
   * Pay the winning Outcome and mark the Market resolved. Idempotent on the
   * ledger ref, so a second call pays nobody twice.
   */
  payout(marketId: string, winningOutcomeId: string, now: Date): Promise<SettlementResult>;
  /** Refund every Position at cost and mark the Market voided. Idempotent too. */
  refund(marketId: string, reason: string, now: Date): Promise<SettlementResult>;
  /** Remember that a Market is waiting on a quarantine review. */
  hold(marketId: string, until: Date, reason: string): Promise<void>;
}

export interface ResolutionRun {
  /** Markets that stopped taking trades on this run. */
  closed: number;
  resolved: number;
  voided: number;
  held: number;
  skipped: number;
  /** Credits paid to winners, and Credits returned by voided Markets. */
  paid: number;
  refunded: number;
}

/** Close what is due, settle what can be settled. Safe to call as often as anyone likes. */
export async function runResolution(
  store: ResolutionStore,
  now: Date = new Date(),
): Promise<ResolutionRun> {
  const run: ResolutionRun = {
    closed: await store.closeExpired(now),
    resolved: 0,
    voided: 0,
    held: 0,
    skipped: 0,
    paid: 0,
    refunded: 0,
  };

  for (const market of await store.dueForResolution(now)) {
    const snapshot = await store.snapshotFor(market);
    const action = planResolution(market, snapshot, now);

    switch (action.kind) {
      case "resolve": {
        const result = await store.payout(market.id, action.winningOutcomeId, now);
        run.resolved += 1;
        run.paid = roundCredits(run.paid + result.credits);
        break;
      }
      case "void": {
        const result = await store.refund(market.id, action.reason, now);
        run.voided += 1;
        run.refunded = roundCredits(run.refunded + result.credits);
        break;
      }
      case "hold":
        await store.hold(market.id, action.until, action.reason);
        run.held += 1;
        break;
      case "skip":
        run.skipped += 1;
        break;
    }
  }

  return run;
}
