import { lmsrSharesForCredits, roundCredits } from "@tokenburnmarket/core";
import { MAX_TRADE_SHARES } from "./markets";

export const BALANCE_ALLOCATION_PRESETS = [10, 25, 50, 100] as const;

export function shareInputValue(shares: number): string {
  return shares.toFixed(4).replace(/\.?0+$/, "");
}

/**
 * A completed order leaves a receipt, not another live quote for the submitted
 * amount. The next edit or allocation choice starts a fresh order.
 */
export function displayedTradeAmount({
  manualAmount,
  allocatedShares,
  lastTradeFilled,
  editingNextTrade,
}: {
  manualAmount: string;
  allocatedShares: number | null;
  lastTradeFilled: boolean;
  editingNextTrade: boolean;
}): string {
  if (lastTradeFilled && !editingNextTrade) return "";
  return allocatedShares === null
    ? manualAmount
    : allocatedShares > 0
      ? shareInputValue(allocatedShares)
      : "";
}

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

/** The spend cap represented by a percentage of the Builder's available Credits. */
export function allocationBudget(balance: number, percent: number): number {
  if (!Number.isFinite(balance) || balance <= 0) return 0;
  return roundCredits((balance * clampPercent(percent)) / 100);
}

export function sharesForBalanceAllocation({
  sharesOutstanding,
  b,
  outcomeIndex,
  balance,
  percent,
}: {
  sharesOutstanding: readonly number[];
  b: number;
  outcomeIndex: number;
  balance: number;
  percent: number;
}): number {
  if (outcomeIndex < 0 || outcomeIndex >= sharesOutstanding.length) return 0;
  const budget = allocationBudget(balance, percent);
  if (budget <= 0) return 0;
  return lmsrSharesForCredits(
    sharesOutstanding,
    b,
    outcomeIndex,
    "buy",
    budget,
    MAX_TRADE_SHARES,
  );
}
