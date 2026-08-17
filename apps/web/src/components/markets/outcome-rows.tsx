/*
  The outcome row, in the anatomy MarketPreview set on the landing page: label
  on the left, price in cents on the right, probability bar underneath. The
  preview was the sketch; this is the same row with real numbers in it.

  The bar carries a word next to it in the accessible name, because a length is
  not a label.
*/
import { formatPriceCents, formatProbability } from "@/lib/markets";
import type { OutcomePrice } from "@/lib/market-queries";

export function OutcomeRow({
  outcome,
  held,
  children,
}: {
  outcome: OutcomePrice;
  /** Shares the viewer holds, shown inline so a position reads next to its price. */
  held?: number;
  children?: React.ReactNode;
}) {
  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 py-3">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.95rem]">
        <span>{outcome.label}</span>
        {held ? (
          <span className="type-data text-[0.78rem] text-subtle tabular-nums">
            you hold {held.toLocaleString("en-US", { maximumFractionDigits: 2 })}
          </span>
        ) : null}
      </div>
      <span className="type-data text-[0.95rem] text-cyber tabular-nums">
        {formatPriceCents(outcome.price)}
      </span>
      <div
        className="col-span-2 h-1.5 overflow-hidden rounded-sm bg-surface-sunken"
        role="img"
        aria-label={`${formatProbability(outcome.price)} chance`}
      >
        <div className="h-full rounded-sm bg-primary" style={{ width: `${outcome.price * 100}%` }} />
      </div>
      {children ? <div className="col-span-2">{children}</div> : null}
    </li>
  );
}

/** The compact version for a list of Markets: the leading outcome and its price. */
export function TopOutcome({ outcomes }: { outcomes: readonly OutcomePrice[] }) {
  if (outcomes.length === 0) return null;
  const leader = outcomes.reduce((a, b) => (b.price > a.price ? b : a));
  return (
    <span className="flex items-baseline gap-2">
      <span className="truncate text-[0.9rem]">{leader.label}</span>
      <span className="type-data text-[0.9rem] text-cyber tabular-nums">
        {formatPriceCents(leader.price)}
      </span>
    </span>
  );
}
