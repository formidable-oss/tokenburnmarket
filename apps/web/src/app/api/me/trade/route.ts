/*
  POST /api/me/trade: quote a trade, or place it.

  Two shapes on purpose. Without `confirm: true` this prices the trade and
  writes nothing, which is what an agent should show a person before spending
  their Credits. With `confirm: true` it runs the same trade through the same
  transactional writer the site uses, so there is one place where Credits move.

  A quote is an offer, never a promise: the writer re-prices under the Market
  lock, and the price can move between the two calls.
*/
import { deviceCaller } from "@/lib/me-api";
import { normalizeShareAmount } from "@/lib/markets";
import { executeTrade, quoteTrade, type TradeIntent } from "@/lib/trade-store";

export const dynamic = "force-dynamic";

interface TradeBody {
  marketId?: unknown;
  outcomeId?: unknown;
  side?: unknown;
  credits?: unknown;
  shares?: unknown;
  confirm?: unknown;
}

const bad = (error: string) => Response.json({ error }, { status: 400 });

/** A positive finite amount, or null. Strings are accepted because agents send them. */
function amount(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function POST(request: Request) {
  const guard = await deviceCaller(request);
  if (!guard.ok) return guard.response;
  const { caller } = guard;

  let body: TradeBody;
  try {
    body = (await request.json()) as TradeBody;
  } catch {
    return bad("expected a JSON body");
  }

  const marketId = typeof body.marketId === "string" ? body.marketId.trim() : "";
  const outcomeId = typeof body.outcomeId === "string" ? body.outcomeId.trim() : "";
  if (!marketId || !outcomeId) return bad("marketId and outcomeId are required");

  const side = body.side === "sell" ? "sell" : body.side === "buy" ? "buy" : null;
  if (!side) return bad("side is buy or sell");

  const credits = amount(body.credits);
  const shares = amount(body.shares);
  if (credits === null && shares === null) return bad("give credits or shares");

  const intent: TradeIntent = { outcomeId, side };
  if (credits !== null) {
    intent.credits = credits;
  } else {
    const normalized = normalizeShareAmount(shares);
    if (!normalized.ok) return bad(normalized.error);
    intent.shares = normalized.value;
  }

  const quote = await quoteTrade(caller.builderId, marketId, intent);
  if (!quote.ok) {
    return Response.json({ error: quote.code, message: quote.message }, { status: 409 });
  }

  const priced = {
    marketId,
    outcomeId,
    side,
    shares: quote.plan.quote.shares,
    credits: quote.plan.quote.credits,
    averagePrice: quote.plan.quote.averagePrice,
    priceBefore: quote.plan.quote.priceBefore,
    priceAfter: quote.plan.quote.priceAfter,
    balance: quote.balance,
    balanceAfter: quote.balanceAfter,
  };

  // The default is to spend nothing. Only an explicit `true` places the trade.
  if (body.confirm !== true) {
    return Response.json({ placed: false, quote: priced });
  }

  const result = await executeTrade(caller.builderId, marketId, {
    outcomeId,
    side,
    shares: quote.shares,
    /*
      The quote above is what the caller was just shown, so it is what the
      writer checks the book against: a Market that moved against them between
      the two calls comes back as `price_moved` rather than filling quietly.
    */
    previewAveragePrice: quote.plan.quote.averagePrice,
    acceptSlippage: false,
  });

  if (!result.ok) {
    return Response.json(
      {
        error: result.code,
        message: result.message,
        offered: result.quote
          ? { averagePrice: result.quote.averagePrice, credits: result.quote.credits }
          : undefined,
      },
      { status: 409 },
    );
  }

  return Response.json({
    placed: true,
    tradeId: result.tradeId,
    filled: {
      marketId,
      outcomeId,
      side,
      shares: result.plan.quote.shares,
      credits: result.plan.quote.credits,
      averagePrice: result.plan.quote.averagePrice,
      priceAfter: result.plan.quote.priceAfter,
    },
    balanceAfter: result.balanceAfter,
  });
}
