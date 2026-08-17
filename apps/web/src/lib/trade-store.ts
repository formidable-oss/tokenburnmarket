/*
  The Drizzle half of trading. Statements only, no decisions: lib/trade.ts owns
  those.

  One trade is one interactive transaction, which is why this module uses `dbTx`
  and not `db`. The transaction opens by locking the Market row, so two people
  hitting Buy at the same instant queue up and the second one prices against the
  book the first one left behind. Nothing here reprices anything without that
  lock held.

  It then locks the Builder row. That is a second, narrower guarantee: a Builder
  trading two Markets at once still spends one balance, so the ledger cannot go
  negative. The two locks are always taken in that order, Market then Builder,
  so two trades can never wait on each other.
*/
import { lmsrSharesForCredits, type TradeSide } from "@tokenburnmarket/core";
import { and, eq, sql } from "drizzle-orm";
import { db, dbTx } from "@/db";
import { builders, creditLedger, markets, outcomes, positions, trades } from "@/db/schema";
import { MAX_TRADE_SHARES } from "./markets";
import { planTrade, type TradePlan, type TradeRejection, type TradeRequest } from "./trade";

export interface TradeReceipt {
  ok: true;
  tradeId: string;
  plan: TradePlan;
  /** The Builder's Credit balance once the trade is written. */
  balanceAfter: number;
}

/*
  `builders.credit_balance` as the ledger says it should be, never incremented
  blindly. Same expression as the mint writes (lib/mint-store.ts).
*/
const balanceFromLedger = sql<number>`coalesce((
  select sum(${creditLedger.delta})
  from ${creditLedger}
  where ${creditLedger.builderId} = ${builders.id}
), 0)`;

/*
  The same sum, read rather than written. It is spelled out instead of built
  from Drizzle columns because a column interpolated into a select projection
  renders without its table name: the correlated `where` would then compare
  credit_ledger to itself and every balance would read as zero.
*/
const currentBalance = sql<string>`coalesce((
  select sum(ledger.delta) from credit_ledger ledger
  where ledger.builder_id = builders.id
), 0)`;

const missingMarket: TradeRejection = {
  ok: false,
  code: "unknown_market",
  message: "That market does not exist.",
};

/**
 * Price and settle one trade, or refuse it. Returns rather than throws for every
 * refusal a trader can cause, so the form can say what happened.
 */
export async function executeTrade(
  builderId: string,
  marketId: string,
  request: TradeRequest,
  now: Date = new Date(),
): Promise<TradeReceipt | TradeRejection> {
  return dbTx.transaction(async (tx) => {
    const [market] = await tx
      .select({
        status: markets.status,
        closesAt: markets.closesAt,
        b: markets.b,
      })
      .from(markets)
      .where(eq(markets.id, marketId))
      .for("update");
    if (!market) return missingMarket;

    // Taken after the Market lock, always, or two trades could wait on each other.
    const [balanceRow] = await tx
      .select({ balance: currentBalance })
      .from(builders)
      .where(eq(builders.id, builderId))
      .for("update");
    if (!balanceRow) return missingMarket;

    const book = await tx
      .select({ id: outcomes.id, sharesOutstanding: outcomes.sharesOutstanding })
      .from(outcomes)
      .where(eq(outcomes.marketId, marketId))
      .orderBy(outcomes.sort);

    const [held] = await tx
      .select({ shares: positions.shares, costBasis: positions.costBasis })
      .from(positions)
      .where(
        and(
          eq(positions.marketId, marketId),
          eq(positions.outcomeId, request.outcomeId),
          eq(positions.builderId, builderId),
        ),
      );

    const plan = planTrade(
      {
        status: market.status,
        closesAt: market.closesAt,
        b: market.b,
        outcomeIds: book.map((outcome) => outcome.id),
        sharesOutstanding: book.map((outcome) => outcome.sharesOutstanding),
      },
      {
        balance: Number(balanceRow.balance),
        positionShares: held?.shares ?? 0,
        positionCostBasis: held?.costBasis ?? 0,
      },
      request,
      now,
    );
    if (!plan.ok) return plan;

    /*
      The trade id is generated here because the ledger row refs it, and the
      unique (builder, reason, ref) index turns that ref into the idempotency
      key: a retry of the same trade id can never spend twice.
    */
    const tradeId = crypto.randomUUID();

    await tx
      .update(outcomes)
      .set({ sharesOutstanding: plan.outcomeSharesAfter })
      .where(eq(outcomes.id, request.outcomeId));

    await tx
      .insert(positions)
      .values({
        marketId,
        outcomeId: request.outcomeId,
        builderId,
        shares: plan.positionSharesAfter,
        costBasis: plan.positionCostBasisAfter,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [positions.marketId, positions.outcomeId, positions.builderId],
        set: {
          shares: plan.positionSharesAfter,
          costBasis: plan.positionCostBasisAfter,
          updatedAt: now,
        },
      });

    await tx.insert(trades).values({
      id: tradeId,
      marketId,
      outcomeId: request.outcomeId,
      builderId,
      side: request.side,
      shares: plan.quote.shares,
      credits: plan.quote.credits,
      priceAfter: plan.quote.priceAfter,
      createdAt: now,
    });

    await tx.insert(creditLedger).values({
      builderId,
      delta: plan.delta,
      reason: request.side,
      refId: tradeId,
      createdAt: now,
    });

    const [updated] = await tx
      .update(builders)
      .set({ creditBalance: balanceFromLedger })
      .where(eq(builders.id, builderId))
      .returning({ balance: builders.creditBalance });

    return { ok: true, tradeId, plan, balanceAfter: updated?.balance ?? 0 };
  });
}

/**
 * What a trader wants, before it is known how many shares that is. A budget in
 * Credits is what an agent naturally asks for ("bet 50 on yes"), and it becomes
 * a share count against the live book.
 */
export interface TradeIntent {
  outcomeId: string;
  side: TradeSide;
  /** Shares to trade. Ignored when `credits` is set. */
  shares?: number;
  /** Credits to spend on a buy, or to raise on a sell. */
  credits?: number;
}

export interface TradeQuote {
  ok: true;
  /** The share count the intent resolves to, which is what an execution must be given. */
  shares: number;
  plan: TradePlan;
  balance: number;
  balanceAfter: number;
  /** What the trader already holds in this Outcome. */
  positionShares: number;
}

/**
 * Price an intent without touching anything. Same rules as `executeTrade`, run
 * through the same `planTrade`, but read outside a transaction and with no row
 * locks: a quote is an offer, and the writer re-prices it under the lock anyway.
 *
 * This is what a caller shows before asking someone to confirm. It is never a
 * promise, and the price it reports can move before the trade lands.
 */
export async function quoteTrade(
  builderId: string,
  marketId: string,
  intent: TradeIntent,
  now: Date = new Date(),
): Promise<TradeQuote | TradeRejection> {
  const [market] = await db
    .select({ status: markets.status, closesAt: markets.closesAt, b: markets.b })
    .from(markets)
    .where(eq(markets.id, marketId))
    .limit(1);
  if (!market) return missingMarket;

  const [balanceRow] = await db
    .select({ balance: currentBalance })
    .from(builders)
    .where(eq(builders.id, builderId))
    .limit(1);
  if (!balanceRow) return missingMarket;

  const book = await db
    .select({ id: outcomes.id, sharesOutstanding: outcomes.sharesOutstanding })
    .from(outcomes)
    .where(eq(outcomes.marketId, marketId))
    .orderBy(outcomes.sort);

  const [held] = await db
    .select({ shares: positions.shares, costBasis: positions.costBasis })
    .from(positions)
    .where(
      and(
        eq(positions.marketId, marketId),
        eq(positions.outcomeId, intent.outcomeId),
        eq(positions.builderId, builderId),
      ),
    );

  const tradeBook = {
    status: market.status,
    closesAt: market.closesAt,
    b: market.b,
    outcomeIds: book.map((outcome) => outcome.id),
    sharesOutstanding: book.map((outcome) => outcome.sharesOutstanding),
  };
  const trader = {
    balance: Number(balanceRow.balance),
    positionShares: held?.shares ?? 0,
    positionCostBasis: held?.costBasis ?? 0,
  };

  const outcomeIndex = tradeBook.outcomeIds.indexOf(intent.outcomeId);
  if (outcomeIndex < 0) {
    return { ok: false, code: "unknown_outcome", message: "That outcome is not in this market." };
  }

  /*
    A budget becomes a share count here, against the book as it stands. It is the
    inverse of the same pricing function `planTrade` then charges, so the quote
    that comes back spends at most what was asked for.
  */
  const shares =
    intent.credits !== undefined
      ? lmsrSharesForCredits(
          tradeBook.sharesOutstanding,
          tradeBook.b,
          outcomeIndex,
          intent.side,
          intent.credits,
          intent.side === "sell" ? trader.positionShares : MAX_TRADE_SHARES,
        )
      : (intent.shares ?? 0);

  if (shares <= 0) {
    return {
      ok: false,
      code: intent.side === "sell" ? "insufficient_shares" : "insufficient_balance",
      message: "That is not enough to trade.",
    };
  }

  const plan = planTrade(
    tradeBook,
    trader,
    {
      outcomeId: intent.outcomeId,
      side: intent.side,
      shares,
      // No preview was shown, so there is nothing to check the price against.
      previewAveragePrice: 0,
      acceptSlippage: false,
    },
    now,
  );
  if (!plan.ok) return plan;

  return {
    ok: true,
    shares,
    plan,
    balance: trader.balance,
    balanceAfter: Math.round((trader.balance + plan.delta) * 10_000) / 10_000,
    positionShares: trader.positionShares,
  };
}
