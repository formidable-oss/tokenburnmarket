/*
  The latest settled Markets: who won and how much went to whom. This is where
  "the house actually pays" becomes visible to people who did not bet, which is
  half of why anyone bets the next time.
*/
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatCredits } from "@/lib/credits";
import type { SettledMarket } from "@/lib/market-queries";
import { scopeLabel } from "@/lib/markets";

export function SettledList({ markets }: { markets: readonly SettledMarket[] }) {
  return (
    <section className="min-w-0">
      <h2 className="type-label">recently settled</h2>
      {markets.length === 0 ? (
        <p className="mt-4 max-w-[48ch] text-[0.95rem] text-muted">
          Nothing settled with bets on it yet. The first payout shows up here.
        </p>
      ) : (
        <ol className="mt-4 rounded-(--radius-panel) border border-border bg-surface">
          {markets.map((market) => (
            <li key={market.id} className="border-b border-border-faint last:border-b-0">
              <Link
                href={`/m/${market.id}`}
                className="block px-5 py-4 hover:bg-surface-raised sm:px-6"
              >
                <p className="text-[0.95rem]">{market.question}</p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  {market.status === "resolved" ? (
                    <>
                      <Badge tone="won">won</Badge>
                      <span className="text-[0.88rem]">{market.winnerLabel ?? "unknown"}</span>
                    </>
                  ) : (
                    <Badge tone="neutral">voided</Badge>
                  )}
                  <span className="type-data text-[0.78rem] text-muted tabular-nums">
                    {market.status === "resolved"
                      ? market.paidBuilders > 0
                        ? `paid ${formatCredits(market.paidOut)} to ${market.paidBuilders} of ${market.traders} ${market.traders === 1 ? "trader" : "traders"}`
                        : `nobody backed it · ${market.traders} ${market.traders === 1 ? "trader" : "traders"} lost`
                      : `refunded ${formatCredits(market.paidOut)}`}
                  </span>
                  <span className="type-label text-[0.6rem] text-subtle">
                    {scopeLabel(market.scope)}
                    {market.communityName ? ` · ${market.communityName}` : ""}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
