/*
  What a bet is worth to the person who placed it, before and after it settles.
  Pure, so the trade form, the market page, the profile and the agent API all
  say the same thing about the same numbers.

  The one fact everything here leans on: a winning share pays 1 Credit. So a buy
  of `shares` for `cost` pays `shares` if it wins, and the profit is the gap. At
  95¢ that gap is a twentieth of the stake, while a loss is all of it. People
  were staking whole balances at those prices and reading the small payout as
  "nothing was paid", so the gap is shown before the trade, not discovered after.
*/
import { roundCredits } from "@tokenburnmarket/core";
import type { MarketStatus } from "./markets";

/** Above this average price a buy risks far more than it can win, so the form says so. */
export const LONG_ODDS_PRICE = 0.9;

export interface WinScenario {
  /** Credits paid if the outcome wins: one per share. */
  payout: number;
  /** Payout less cost. Never negative for a buy at a price below 1. */
  profit: number;
  /** Profit as a share of cost, 0.25 for +25%. */
  returnRate: number;
}

/** What a buy of `shares` for `cost` Credits pays if its outcome wins. */
export function winScenario(shares: number, cost: number): WinScenario {
  const payout = roundCredits(shares);
  const profit = roundCredits(payout - cost);
  return { payout, profit, returnRate: cost > 0 ? profit / cost : 0 };
}

/** "+25%", rounded to a whole percent, with a decimal only below 10%. */
export function formatReturn(rate: number): string {
  const percent = rate * 100;
  // Rounding dust either side of zero reads as nothing, not as "-0.0%".
  if (Math.abs(percent) < 0.05) return "0%";
  const shown = Math.abs(percent) < 10 ? percent.toFixed(1) : Math.round(percent).toString();
  return `${percent < 0 ? "" : "+"}${shown}%`;
}

/*
  Where one Builder's bet on one Market stands. "Settling" covers the gap between
  close and payout, which is up to two days for a weekly Market (period end, a
  day for late Syncs, then the nightly run), so it gets its own word rather than
  reading as closed-and-forgotten.

  A resolved bet is won or lost on its net, not on whether settling paid it: a
  trader who sold out at a profit before close was paid nothing at settlement
  and still came out ahead, and a hedge that held the winner can still be down.
*/
export type BetState = "open" | "settling" | "won" | "lost" | "even" | "refunded";

export function betState(
  status: MarketStatus,
  closesAt: Date,
  flows: BetFlows,
  now: Date = new Date(),
): BetState {
  if (status === "voided") return "refunded";
  if (status === "resolved") {
    const net = betNet(flows);
    return net > 0 ? "won" : net < 0 ? "lost" : "even";
  }
  if (status === "open" && closesAt.getTime() > now.getTime()) return "open";
  return "settling";
}

/** One Builder's money in and out of one Market. */
export interface BetFlows {
  /** Credits spent buying shares. Positive. */
  bought: number;
  /** Credits raised selling shares. Positive. */
  sold: number;
  /** Credits the settlement paid: winnings, or the refund of a voided Market. */
  paid: number;
}

/**
 * Realised result of a settled bet: everything that came back less everything
 * that went in. This is the number Credits Won sums, so a voided Market nets to
 * zero (less any loss already taken by selling) instead of counting as a loss.
 */
export function betNet(flows: BetFlows): number {
  return roundCredits(flows.paid + flows.sold - flows.bought);
}

/** Whether a state is final, which is when the net is a result rather than a guess. */
export function isSettled(state: BetState): boolean {
  return state === "won" || state === "lost" || state === "even" || state === "refunded";
}

/** Settled bets won and lost, and the realised net over them. Open ones are not in it. */
export function betRecord(bets: readonly { state: BetState; net: number | null }[]) {
  const settled = bets.filter((bet) => bet.net !== null);
  return {
    settled: settled.length,
    won: settled.filter((bet) => bet.state === "won").length,
    lost: settled.filter((bet) => bet.state === "lost").length,
    net: roundCredits(settled.reduce((total, bet) => total + (bet.net ?? 0), 0)),
  };
}
