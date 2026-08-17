/*
  The decision half of trading. Given a Market's book, what the trader holds and
  what they asked for, this says yes with every number the writer needs, or no
  with a reason. It touches nothing: no database, no clock beyond the `now` it
  is handed, so the rules are unit tested without either.

  The database half is lib/trade-store.ts, which loads the book under a row lock
  and applies the plan.
*/
import {
  DEFAULT_SLIPPAGE_TOLERANCE,
  lmsrAdverseMove,
  lmsrQuote,
  roundCredits,
  type LmsrQuote,
  type TradeSide,
} from "@tokenburnmarket/core";
import type { MarketStatus } from "./markets";

/** The Market as the AMM sees it. Outcome order is the `sort` order, everywhere. */
export interface TradeBook {
  status: MarketStatus;
  closesAt: Date;
  b: number;
  outcomeIds: readonly string[];
  sharesOutstanding: readonly number[];
}

/** What the trader has, read in the same transaction as the book. */
export interface TraderState {
  /** Credits, as the ledger sums to. */
  balance: number;
  /** Shares already held in the Outcome being traded. */
  positionShares: number;
  /** What those shares cost. */
  positionCostBasis: number;
}

export interface TradeRequest {
  outcomeId: string;
  side: TradeSide;
  shares: number;
  /**
   * The average price the trader was shown before they submitted. Zero means no
   * preview, which skips the slippage check: nothing was promised.
   */
  previewAveragePrice: number;
  /** Set when the trader has agreed to take whatever price the book gives. */
  acceptSlippage: boolean;
}

export type TradeRejectionCode =
  | "unknown_market"
  | "market_closed"
  | "unknown_outcome"
  | "insufficient_balance"
  | "insufficient_shares"
  | "price_moved";

export interface TradeRejection {
  ok: false;
  code: TradeRejectionCode;
  message: string;
  /** Present on `price_moved`, so the form can offer the new price to accept. */
  quote?: LmsrQuote;
}

export interface TradePlan {
  ok: true;
  quote: LmsrQuote;
  /** Index of the Outcome in the book, which is also the LMSR's index. */
  outcomeIndex: number;
  /** Credit ledger delta: negative for a buy, positive for a sell. */
  delta: number;
  /** Shares outstanding for the Outcome once the trade lands. */
  outcomeSharesAfter: number;
  /** The trader's Position afterwards. */
  positionSharesAfter: number;
  positionCostBasisAfter: number;
}

/** Positions and shares outstanding carry four decimals, same as Credits. */
function roundShares(shares: number): number {
  return Math.round(shares * 10_000) / 10_000;
}

const closed: TradeRejection = {
  ok: false,
  code: "market_closed",
  message: "This market is not taking trades.",
};

/**
 * Price the trade and check every rule that could refuse it, in the order a
 * person would: is the Market open, does the Outcome exist, can they afford it
 * or do they hold it, and did the price move under them while they typed.
 */
export function planTrade(
  book: TradeBook,
  trader: TraderState,
  request: TradeRequest,
  now: Date = new Date(),
  tolerance: number = DEFAULT_SLIPPAGE_TOLERANCE,
): TradePlan | TradeRejection {
  if (book.status !== "open" || book.closesAt.getTime() <= now.getTime()) return closed;

  const outcomeIndex = book.outcomeIds.indexOf(request.outcomeId);
  if (outcomeIndex < 0) {
    return { ok: false, code: "unknown_outcome", message: "That outcome is not in this market." };
  }

  const shares = roundShares(request.shares);
  if (request.side === "sell" && shares > trader.positionShares + 1e-9) {
    return {
      ok: false,
      code: "insufficient_shares",
      message: "You do not hold that many shares.",
    };
  }

  const quote = lmsrQuote(
    book.sharesOutstanding,
    book.b,
    outcomeIndex,
    request.side,
    // A sell of the whole position must not be blocked by a rounding hair.
    request.side === "sell" ? Math.min(shares, book.sharesOutstanding[outcomeIndex]) : shares,
  );

  if (request.side === "buy" && quote.credits > trader.balance) {
    return {
      ok: false,
      code: "insufficient_balance",
      message: "Not enough credits for that trade.",
    };
  }

  /*
    The slippage guard compares the price the trader was shown against the one
    the book gives now, and only refuses when the move went against them. A
    market that moved in their favour is not a reason to refuse a trade.
  */
  if (!request.acceptSlippage) {
    const move = lmsrAdverseMove(request.side, request.previewAveragePrice, quote.averagePrice);
    if (move > tolerance) {
      return {
        ok: false,
        code: "price_moved",
        message: "The price moved while you were deciding.",
        quote,
      };
    }
  }

  const signedShares = request.side === "buy" ? shares : -shares;
  const positionSharesAfter = roundShares(trader.positionShares + signedShares);

  /*
    A sell takes cost basis out in proportion to the shares leaving, so what
    remains is what the remaining shares cost. Selling out zeroes it exactly
    rather than leaving a rounding crumb behind.
  */
  const positionCostBasisAfter =
    request.side === "buy"
      ? roundCredits(trader.positionCostBasis + quote.credits)
      : positionSharesAfter <= 0
        ? 0
        : roundCredits(trader.positionCostBasis * (positionSharesAfter / trader.positionShares));

  return {
    ok: true,
    quote,
    outcomeIndex,
    delta: request.side === "buy" ? -quote.credits : quote.credits,
    outcomeSharesAfter: roundShares(book.sharesOutstanding[outcomeIndex] + signedShares),
    positionSharesAfter: Math.max(0, positionSharesAfter),
    positionCostBasisAfter,
  };
}
