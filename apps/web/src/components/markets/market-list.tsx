/*
  A list of Markets as rows: question, where it lives, the outcome in front and
  when it closes. One row is enough to decide whether to open it, which is what
  a list is for.
*/
import Link from "next/link";
import { TopOutcome } from "./outcome-rows";
import { formatClosesIn, scopeLabel } from "@/lib/markets";
import type { MarketSummary } from "@/lib/market-queries";

export function MarketList({ markets }: { markets: readonly MarketSummary[] }) {
  return (
    <ol className="rounded-(--radius-panel) border border-border bg-surface">
      {markets.map((market) => (
        <li key={market.id} className="border-b border-border-faint last:border-b-0">
          <Link
            href={`/m/${market.id}`}
            className="grid grid-cols-1 gap-x-6 gap-y-2 px-5 py-4 hover:bg-surface-raised sm:grid-cols-[1fr_auto] sm:px-6"
          >
            <div className="min-w-0">
              <p className="text-[0.98rem]">{market.question}</p>
              <p className="type-label mt-1.5 text-subtle">
                {scopeLabel(market.scope)}
                {market.communityName ? ` · ${market.communityName}` : ""}
                {market.scope === "country" && market.country ? ` · ${market.country}` : ""}
              </p>
            </div>
            <div className="flex items-baseline gap-4 sm:flex-col sm:items-end sm:gap-1">
              <TopOutcome outcomes={market.outcomes} />
              <span className="type-data text-[0.78rem] text-subtle tabular-nums">
                {formatClosesIn(market.closesAt)}
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ol>
  );
}
