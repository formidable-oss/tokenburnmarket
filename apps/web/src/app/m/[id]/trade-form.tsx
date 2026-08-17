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
  const [amount, setAmount] = useState("10");

  const holding = held[outcomeId] ?? 0;

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

  return (
    <form action={action}>
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
                onChange={() => setOutcomeId(outcome.id)}
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
            onClick={() => setSide(option)}
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

      <label className="mt-6 block" htmlFor="shares">
        <span className="type-label">shares</span>
        <input
          id="shares"
          name="shares"
          inputMode="decimal"
          required
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
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
          {state.status === "filled" && state.filled ? (
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
