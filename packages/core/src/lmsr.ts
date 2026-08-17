// Hanson's Logarithmic Market Scoring Rule (ADR 0002).
//
// A Market holds `n` Outcomes with `shares[i]` outstanding and a liquidity
// parameter `b`. The house is the counterparty: it always quotes a price, and
// its worst-case loss over the life of the Market is bounded by `b * ln(n)`.
// A winning share pays 1 Credit. No fees in v1.
//
// All amounts in and out are Credits. Costs are rounded up and proceeds down to
// Credit precision so a buy followed by an immediate sell can never profit.

import { CREDIT_DECIMALS, roundCreditsDown, roundCreditsUp } from "./mint";

export { CREDIT_DECIMALS };

/** Liquidity parameter from scope size (ADR 0002): `b = 20 + 5 * members`. */
export function lmsrLiquidityForMembers(members: number): number {
  return 20 + 5 * Math.max(0, Math.floor(members));
}

function assertMarket(shares: readonly number[], b: number): void {
  if (shares.length < 2) throw new RangeError("a Market needs at least 2 outcomes");
  if (!Number.isFinite(b) || b <= 0) throw new RangeError("b must be a positive finite number");
  for (const q of shares) {
    if (!Number.isFinite(q)) throw new RangeError("shares outstanding must be finite");
  }
}

/**
 * Cost function `C(q) = b * ln(sum_i exp(q_i / b))`, computed through the
 * log-sum-exp shift so large share counts do not overflow.
 */
export function lmsrCost(shares: readonly number[], b: number): number {
  assertMarket(shares, b);
  let max = -Infinity;
  for (const q of shares) if (q > max) max = q;
  let sum = 0;
  for (const q of shares) sum += Math.exp((q - max) / b);
  return max + b * Math.log(sum);
}

/**
 * Instantaneous price of every Outcome: `p_i = exp(q_i / b) / sum_j exp(q_j / b)`.
 * Prices are positive and sum to 1, so each one reads as a probability.
 */
export function lmsrPrices(shares: readonly number[], b: number): number[] {
  assertMarket(shares, b);
  let max = -Infinity;
  for (const q of shares) if (q > max) max = q;
  const weights = shares.map((q) => Math.exp((q - max) / b));
  const total = weights.reduce((a, w) => a + w, 0);
  return weights.map((w) => w / total);
}

/** Instantaneous price of one Outcome. */
export function lmsrPrice(shares: readonly number[], b: number, outcome: number): number {
  return lmsrPrices(shares, b)[assertOutcome(shares, outcome)];
}

function assertOutcome(shares: readonly number[], outcome: number): number {
  if (!Number.isInteger(outcome) || outcome < 0 || outcome >= shares.length) {
    throw new RangeError(`outcome ${outcome} is out of range`);
  }
  return outcome;
}

function assertShareCount(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError("share amount must be a non-negative finite number");
  }
  return amount;
}

/**
 * Credits charged to buy `amount` shares of `outcome`: `C(q + amount) - C(q)`,
 * rounded up. Always strictly between `amount * price` and `amount` Credits.
 */
export function lmsrCostToBuy(
  shares: readonly number[],
  b: number,
  outcome: number,
  amount: number,
): number {
  assertMarket(shares, b);
  assertOutcome(shares, outcome);
  if (assertShareCount(amount) === 0) return 0;
  const after = shares.slice();
  after[outcome] += amount;
  return roundCreditsUp(lmsrCost(after, b) - lmsrCost(shares, b));
}

/**
 * Credits paid out to sell `amount` shares of `outcome`: `C(q) - C(q - amount)`,
 * rounded down. Callers enforce that the seller actually holds the shares.
 */
export function lmsrProceedsOfSell(
  shares: readonly number[],
  b: number,
  outcome: number,
  amount: number,
): number {
  assertMarket(shares, b);
  assertOutcome(shares, outcome);
  if (assertShareCount(amount) === 0) return 0;
  const after = shares.slice();
  after[outcome] -= amount;
  return roundCreditsDown(lmsrCost(shares, b) - lmsrCost(after, b));
}

/**
 * Upper bound on what the house can lose over a Market's life: `b * ln(n)`.
 * This subsidy is minted at resolution, so keep `b` modest.
 */
export function lmsrMaxHouseLoss(b: number, outcomeCount: number): number {
  if (!Number.isFinite(b) || b <= 0) throw new RangeError("b must be a positive finite number");
  if (!Number.isInteger(outcomeCount) || outcomeCount < 2) {
    throw new RangeError("a Market needs at least 2 outcomes");
  }
  return b * Math.log(outcomeCount);
}

/**
 * Realised house profit if `winningOutcome` pays out now, given the shares
 * outstanding and the shares the Market opened with (usually all zero).
 * Negative means the house subsidised the Market; never below `-b * ln(n)`.
 */
export function lmsrHouseProfit(
  shares: readonly number[],
  b: number,
  winningOutcome: number,
  openingShares: readonly number[] = shares.map(() => 0),
): number {
  assertMarket(shares, b);
  assertOutcome(shares, winningOutcome);
  const collected = lmsrCost(shares, b) - lmsrCost(openingShares, b);
  const paidOut = shares[winningOutcome] - openingShares[winningOutcome];
  return collected - paidOut;
}

/** Which way a trade goes against the house. */
export type TradeSide = "buy" | "sell";

/**
 * Everything a screen or a server action needs to know about one trade before
 * it happens. The web app calls `lmsrQuote` in the browser to preview and again
 * on the server to price for real, so the two cannot disagree by construction.
 */
export interface LmsrQuote {
  side: TradeSide;
  outcome: number;
  /** Shares traded, as asked for. */
  shares: number;
  /** Credits paid (buy) or received (sell). Never negative. */
  credits: number;
  /** `credits / shares`, the price actually paid per share. Zero for a zero-share trade. */
  averagePrice: number;
  /** Instantaneous price of the outcome before the trade. */
  priceBefore: number;
  /** Instantaneous price of the outcome after it. */
  priceAfter: number;
  /** Shares outstanding across all outcomes once the trade lands. */
  sharesAfter: number[];
}

/**
 * Price one trade against the book. Buys cost `C(q + x) - C(q)` rounded up,
 * sells pay `C(q) - C(q - x)` rounded down, so a buy followed by an immediate
 * sell is never profitable.
 *
 * Selling more shares than are outstanding is refused here rather than by the
 * caller, because negative shares outstanding is not a Market state we allow.
 */
export function lmsrQuote(
  shares: readonly number[],
  b: number,
  outcome: number,
  side: TradeSide,
  amount: number,
): LmsrQuote {
  assertMarket(shares, b);
  assertOutcome(shares, outcome);
  assertShareCount(amount);
  if (side === "sell" && amount > shares[outcome]) {
    throw new RangeError("cannot sell more shares than are outstanding");
  }

  const after = shares.slice();
  after[outcome] += side === "buy" ? amount : -amount;

  const credits =
    side === "buy"
      ? lmsrCostToBuy(shares, b, outcome, amount)
      : lmsrProceedsOfSell(shares, b, outcome, amount);

  return {
    side,
    outcome,
    shares: amount,
    credits,
    averagePrice: amount === 0 ? 0 : credits / amount,
    priceBefore: lmsrPrice(shares, b, outcome),
    priceAfter: lmsrPrice(after, b, outcome),
    sharesAfter: after,
  };
}

/** How far the price may move between preview and execution before a trade is refused. */
export const DEFAULT_SLIPPAGE_TOLERANCE = 0.01;

/**
 * How much worse a quote got, relative to what was previewed: positive means
 * the trader lost ground, negative means the book moved in their favour.
 *
 * Buying is worse when it costs more per share, selling when it pays less. A
 * preview of zero means nothing was previewed and reports no move, which leaves
 * the decision with the caller.
 */
export function lmsrAdverseMove(
  side: TradeSide,
  previewedAveragePrice: number,
  executedAveragePrice: number,
): number {
  if (!Number.isFinite(previewedAveragePrice) || previewedAveragePrice <= 0) return 0;
  const delta =
    side === "buy"
      ? executedAveragePrice - previewedAveragePrice
      : previewedAveragePrice - executedAveragePrice;
  return delta / previewedAveragePrice;
}

/**
 * The largest number of shares a budget of `credits` buys, or that selling
 * raises at most `credits`. The inverse of `lmsrQuote`, found by bisection over
 * the same pricing functions rather than a second formula, so a quote priced by
 * budget and one priced by shares can never disagree.
 *
 * `maxShares` caps the search: a sell is capped by what the seller holds, and a
 * buy by the Market's own share limit. The answer is rounded down to Credit
 * precision, so the resulting trade always costs at most `credits`.
 */
export function lmsrSharesForCredits(
  shares: readonly number[],
  b: number,
  outcome: number,
  side: TradeSide,
  credits: number,
  maxShares: number,
): number {
  assertMarket(shares, b);
  assertOutcome(shares, outcome);
  if (!Number.isFinite(credits) || credits <= 0) return 0;

  const ceiling = side === "sell" ? Math.min(maxShares, shares[outcome]) : maxShares;
  if (!(ceiling > 0)) return 0;

  const priced = (amount: number) =>
    side === "buy"
      ? lmsrCostToBuy(shares, b, outcome, amount)
      : lmsrProceedsOfSell(shares, b, outcome, amount);

  // Spending the whole budget is impossible past the ceiling, so stop there.
  if (priced(ceiling) <= credits) return roundCreditsDown(ceiling);

  let low = 0;
  let high = ceiling;
  // 60 halvings take the interval below Credit precision for any realistic book.
  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    if (priced(mid) <= credits) low = mid;
    else high = mid;
  }
  const answer = roundCreditsDown(low);
  // Rounding down can only ever cost less, never more, but check rather than assume.
  return priced(answer) <= credits ? answer : roundCreditsDown(low - 10 ** -CREDIT_DECIMALS);
}
