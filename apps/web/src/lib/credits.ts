/*
  How Credits read on screen. Balances are stored to four decimals; showing all
  four turns a balance into noise, so two is the display precision and whole
  numbers stay whole.
*/
import type { CreditLedgerRow } from "@/db/schema";

export type CreditReason = CreditLedgerRow["reason"];

const format = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** A Credit amount, tabular and unsigned. */
export function formatCredits(credits: number): string {
  return format.format(credits);
}

/** A ledger delta, always carrying its sign so the direction is readable alone. */
export function formatDelta(delta: number): string {
  return `${delta < 0 ? "-" : "+"}${format.format(Math.abs(delta))}`;
}

/** Every reason gets a word, because color alone never says what happened. */
const REASON_LABELS: Record<CreditReason, string> = {
  signup: "signup grant",
  mint: "daily mint",
  buy: "bought shares",
  sell: "sold shares",
  payout: "market payout",
  refund: "refund",
};

export function creditReasonLabel(reason: CreditReason): string {
  return REASON_LABELS[reason];
}

/*
  The Market a settlement row came from. Payouts and refunds are the only rows
  that point at one, and they carry it as `market:<id>`, which is also the key
  that keeps settling idempotent.
*/
const MARKET_REF = /^market:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function creditEntryMarketId(reason: CreditReason, refId: string | null): string | null {
  if ((reason !== "payout" && reason !== "refund") || !refId) return null;
  return MARKET_REF.exec(refId)?.[1] ?? null;
}

/** The day a mint row covers, when the ref carries one. Other reasons have no day. */
export function creditEntryDay(reason: CreditReason, refId: string | null): string | null {
  if (reason !== "mint" || !refId) return null;
  const day = refId.split(":")[0] ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}
