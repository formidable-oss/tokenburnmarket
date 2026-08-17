"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { normalizeShareAmount } from "@/lib/markets";
import { executeTrade } from "@/lib/trade-store";

/*
  The one write on the Market page. It re-prices the trade server side against
  the locked book, so the preview the browser drew is only ever an offer: if the
  book moved against the trader by more than the tolerance, the trade is refused
  and the new price comes back for them to accept.
*/

export type TradeState = {
  status: "idle" | "filled" | "error" | "price_moved";
  message?: string;
  filled?: {
    side: "buy" | "sell";
    shares: number;
    credits: number;
    averagePrice: number;
  };
  /** On `price_moved`, what the book gives now. Submitting again accepts it. */
  offered?: { averagePrice: number; credits: number };
};

const signedOut: TradeState = { status: "error", message: "Sign in again to trade." };

export async function placeTrade(_previous: TradeState, formData: FormData): Promise<TradeState> {
  const session = await auth();
  if (!session?.user?.id) return signedOut;

  const marketId = formData.get("marketId")?.toString() ?? "";
  const outcomeId = formData.get("outcomeId")?.toString() ?? "";
  const side = formData.get("side")?.toString() === "sell" ? "sell" : "buy";
  const shares = normalizeShareAmount(formData.get("shares")?.toString());
  if (!shares.ok) return { status: "error", message: shares.error };

  const previewAveragePrice = Number(formData.get("previewAveragePrice")?.toString() ?? "0");

  const result = await executeTrade(session.user.id, marketId, {
    outcomeId,
    side,
    shares: shares.value,
    previewAveragePrice: Number.isFinite(previewAveragePrice) ? previewAveragePrice : 0,
    acceptSlippage: formData.get("acceptSlippage") === "on",
  });

  if (!result.ok) {
    if (result.code === "price_moved" && result.quote) {
      return {
        status: "price_moved",
        message: result.message,
        offered: { averagePrice: result.quote.averagePrice, credits: result.quote.credits },
      };
    }
    return { status: "error", message: result.message };
  }

  revalidatePath(`/m/${marketId}`);
  revalidatePath("/markets");
  return {
    status: "filled",
    filled: {
      side,
      shares: result.plan.quote.shares,
      credits: result.plan.quote.credits,
      averagePrice: result.plan.quote.averagePrice,
    },
  };
}
