"use client";

/*
  Buy and sell against the AMM. The preview under the field is `lmsrQuote` from
  core, the same function the server prices with, so what the number says here
  is what the trade costs unless somebody else trades first. When that happens
  the server refuses and offers the new price, which is the second submit.
*/

import { lmsrQuote, type LmsrQuote } from "@tokenburnmarket/core";
import { useActionState, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatCredits } from "@/lib/credits";
import { formatPriceCents, normalizeShareAmount } from "@/lib/markets";
import type { OutcomePrice } from "@/lib/market-queries";
import {
  allocationBudget,
  BALANCE_ALLOCATION_PRESETS,
  displayedTradeAmount,
  sharesForBalanceAllocation,
} from "@/lib/trade-allocation";
import { placeTrade, type TradeState } from "./actions";

const initialState: TradeState = { status: "idle" };

const field =
  "mt-2 w-full rounded-(--radius-control) border border-border bg-surface-sunken px-3 text-sm " +
  "text-foreground placeholder:text-subtle";

export function TradeForm({
  marketId,
  b,
  outcomes,
  held,
  balance,
}: {
  marketId: string;
  b: number;
  outcomes: readonly OutcomePrice[];
  /** Shares the viewer holds, by outcome id. Decides what they may sell. */
  held: Readonly<Record<string, number>>;
  balance: number;
}) {
  const [state, action, pending] = useActionState(placeTrade, initialState);
  const [outcomeId, setOutcomeId] = useState(outcomes[0]?.id ?? "");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [manualAmount, setManualAmount] = useState("10");
  const [allocationPercent, setAllocationPercent] = useState<number | null>(null);
  const [editingAfterFill, setEditingAfterFill] = useState(false);

  const holding = held[outcomeId] ?? 0;
  const allocatedShares = useMemo(() => {
    if (allocationPercent === null || side !== "buy") return null;
    const outcomeIndex = outcomes.findIndex((outcome) => outcome.id === outcomeId);
    return sharesForBalanceAllocation({
      sharesOutstanding: outcomes.map((outcome) => outcome.sharesOutstanding),
      b,
      outcomeIndex,
      balance,
      percent: allocationPercent,
    });
  }, [allocationPercent, b, balance, outcomeId, outcomes, side]);
  const amount = displayedTradeAmount({
    manualAmount,
    allocatedShares,
    lastTradeFilled: state.status === "filled",
    editingNextTrade: editingAfterFill,
  });

  const preview = useMemo<LmsrQuote | null>(() => {
    const shares = normalizeShareAmount(amount);
    const index = outcomes.findIndex((outcome) => outcome.id === outcomeId);
    if (!shares.ok || index < 0) return null;
    // Selling more than is held is refused by the server; do not quote it either.
    if (side === "sell" && shares.value > holding) return null;
    try {
      return lmsrQuote(
        outcomes.map((outcome) => outcome.sharesOutstanding),
        b,
        index,
        side,
        shares.value,
      );
    } catch {
      return null;
    }
  }, [amount, b, holding, outcomeId, outcomes, side]);

  const tooExpensive = side === "buy" && preview !== null && preview.credits > balance;
  const offered = state.status === "price_moved" ? state.offered : undefined;
  const sliderPercent = allocationPercent ?? 10;
  const sliderBudget = allocationBudget(balance, sliderPercent);

  return (
    <form action={action} onSubmit={() => setEditingAfterFill(false)}>
      <input type="hidden" name="marketId" value={marketId} />
      <input type="hidden" name="outcomeId" value={outcomeId} />
      <input type="hidden" name="side" value={side} />
      <input
        type="hidden"
        name="previewAveragePrice"
        value={preview ? preview.averagePrice.toFixed(8) : "0"}
      />

      <fieldset>
        <legend className="type-label">outcome</legend>
        <div className="mt-3 space-y-2">
          {outcomes.map((outcome) => (
            <label
              key={outcome.id}
              className="flex cursor-pointer items-center gap-3 rounded-(--radius-control) border border-border-faint px-3 py-2 hover:border-primary-border"
              htmlFor={`outcome-${outcome.id}`}
            >
              <input
                id={`outcome-${outcome.id}`}
                type="radio"
                name="outcomeChoice"
                value={outcome.id}
                checked={outcomeId === outcome.id}
                onChange={() => {
                  setOutcomeId(outcome.id);
                  setEditingAfterFill(true);
                }}
                className="accent-[color:var(--primary)]"
              />
              <span className="truncate text-[0.92rem]">{outcome.label}</span>
              <span className="type-data ml-auto text-[0.85rem] text-cyber tabular-nums">
                {formatPriceCents(outcome.price)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-6 flex gap-2" role="group" aria-label="Side">
        {(["buy", "sell"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={side === option}
            onClick={() => {
              setSide(option);
              setAllocationPercent(null);
              setEditingAfterFill(true);
            }}
            className={`h-9 flex-1 rounded-(--radius-control) border text-sm ${
              side === option
                ? "border-primary-border bg-primary-subtle text-foreground"
                : "border-border-faint text-muted hover:text-foreground"
            }`}
          >
            {option === "buy" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>

      {side === "buy" ? (
        <fieldset className="mt-6 border-t border-border-faint pt-5">
          <div className="flex min-h-6 items-baseline justify-between gap-4">
            <legend className="type-label">invest from balance</legend>
            <output
              className="type-data text-right text-[0.8rem] text-cyber tabular-nums"
              aria-live="polite"
            >
              {allocationPercent === null
                ? "choose a percentage"
                : `${allocationPercent}% · ${formatCredits(sliderBudget)} cr`}
            </output>
          </div>

          <div
            className="mt-3 grid grid-cols-4 gap-2"
            role="group"
            aria-label="Balance allocation presets"
          >
            {BALANCE_ALLOCATION_PRESETS.map((percent) => (
              <button
                key={percent}
                type="button"
                aria-pressed={allocationPercent === percent}
                onClick={() => {
                  setAllocationPercent(percent);
                  setEditingAfterFill(true);
                }}
                className={`type-data h-10 rounded-(--radius-control) border text-[0.8rem] transition-[background-color,border-color,color,transform] duration-150 ease-(--ease-out-expo) active:translate-y-px ${
                  allocationPercent === percent
                    ? "border-primary-border bg-primary-subtle text-primary-text"
                    : "border-border-faint text-muted hover:border-border-strong hover:text-foreground"
                }`}
              >
                {percent === 100 ? "max" : `${percent}%`}
              </button>
            ))}
          </div>

          <label className="mt-4 block" htmlFor="balance-allocation">
            <span className="sr-only">Percentage of Credit balance to invest</span>
            <span className="relative flex h-10 items-center">
              <span
                aria-hidden="true"
                className="absolute inset-x-0 h-1 overflow-hidden rounded-full bg-surface-sunken"
              >
                <span
                  className="block h-full bg-primary transition-[width] duration-150 ease-(--ease-out-expo)"
                  style={{ width: `${sliderPercent}%` }}
                />
              </span>
              <input
                id="balance-allocation"
                type="range"
                min="1"
                max="100"
                step="1"
                value={sliderPercent}
                onChange={(event) => {
                  setAllocationPercent(Number(event.target.value));
                  setEditingAfterFill(true);
                }}
                aria-valuetext={`${sliderPercent}% of balance, ${formatCredits(sliderBudget)} credits`}
                className="allocation-slider relative w-full"
              />
            </span>
            <span className="type-data flex justify-between text-[0.68rem] text-subtle" aria-hidden="true">
              <span>1%</span>
              <span>100%</span>
            </span>
          </label>
        </fieldset>
      ) : null}

      <label className="mt-6 block" htmlFor="shares">
        <span className="type-label">shares</span>
        <input
          id="shares"
          name="shares"
          inputMode="decimal"
          required
          value={amount}
          onChange={(event) => {
            setManualAmount(event.target.value);
            setAllocationPercent(null);
            setEditingAfterFill(true);
          }}
          className={`${field} type-data h-10 tabular-nums`}
        />
      </label>
      <p className="type-data mt-2 text-[0.8rem] text-subtle tabular-nums">
        {side === "sell"
          ? `you hold ${formatCredits(holding)} shares`
          : `balance ${formatCredits(balance)} cr`}
      </p>

      <dl className="mt-6 space-y-1.5 border-t border-border-faint pt-4 text-[0.85rem]">
        <Line
          term={side === "buy" ? "cost" : "proceeds"}
          value={preview ? `${formatCredits(preview.credits)} cr` : "-"}
        />
        <Line
          term="average price"
          value={preview ? formatPriceCents(preview.averagePrice) : "-"}
        />
        <Line
          term="price after"
          value={preview ? formatPriceCents(preview.priceAfter) : "-"}
        />
      </dl>

      {offered ? (
        <label className="mt-5 flex items-start gap-3" htmlFor="acceptSlippage">
          <input
            id="acceptSlippage"
            type="checkbox"
            name="acceptSlippage"
            className="mt-1 accent-[color:var(--primary)]"
          />
          <span className="text-[0.88rem] text-muted">
            Take it at {formatPriceCents(offered.averagePrice)}, {formatCredits(offered.credits)} cr.
          </span>
        </label>
      ) : null}

      <div className="mt-6 flex items-center gap-4">
        <Button type="submit" disabled={pending || preview === null || tooExpensive}>
          {pending ? "Working" : side === "buy" ? "Buy shares" : "Sell shares"}
        </Button>
        <span aria-live="polite" className="type-data text-[0.8rem]">
          {state.status === "filled" && state.filled && amount === "" ? (
            <span className="text-[color:var(--won)]">
              {state.filled.side === "buy" ? "Bought" : "Sold"}{" "}
              {formatCredits(state.filled.shares)} at{" "}
              {formatPriceCents(state.filled.averagePrice)}
            </span>
          ) : null}
          {state.status === "error" || state.status === "price_moved" ? (
            <span className="text-[color:var(--destructive)]">{state.message}</span>
          ) : null}
          {tooExpensive ? (
            <span className="text-[color:var(--destructive)]">Not enough credits.</span>
          ) : null}
        </span>
      </div>
    </form>
  );
}

function Line({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="type-label text-subtle">{term}</dt>
      <dd className="type-data tabular-nums">{value}</dd>
    </div>
  );
}
