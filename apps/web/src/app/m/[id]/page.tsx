import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth, currentBuilder } from "@/auth";
import { OutcomeRow } from "@/components/markets/outcome-rows";
import { PriceChart } from "@/components/markets/price-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCredits, formatDelta } from "@/lib/credits";
import {
  marketById,
  positionsIn,
  priceHistory,
  recentTrades,
  type MarketDetail,
} from "@/lib/market-queries";
import {
  formatClosesIn,
  formatPriceCents,
  formatResolvesAt,
  isTradable,
  marketRulesText,
  scopeLabel,
  statusLabel,
} from "@/lib/markets";
import { TradeForm } from "./trade-form";

/*
  One Market: what it asks, what the outcomes cost, what the viewer holds, and
  every fill so far. Trading is the only client component on the page; the
  prices, the chart and the tape are all rendered on the server.
*/

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: PageProps<"/m/[id]">): Promise<Metadata> {
  const { id } = await params;
  const market = UUID.test(id) ? await marketById(id) : null;
  if (!market) return { title: "Not found" };

  const title = market.question;
  const description = marketRulesText(market.params, market.resolvesAt);
  const path = `/m/${market.id}`;

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", url: path, title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

const stamp = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  dateStyle: "medium",
  timeStyle: "short",
});

/** The name of the audience, when there is one to name. Global markets have none. */
function whereLine(market: MarketDetail): string | null {
  if (market.scope === "community") return market.communityName;
  if (market.scope === "country") return market.country;
  return null;
}

export default async function MarketPage({ params }: PageProps<"/m/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const market = await marketById(id);
  if (!market) notFound();

  const session = await auth();
  const viewerId = session?.user?.id ?? null;

  const [history, tape, holdings, builder] = await Promise.all([
    priceHistory(market.id),
    recentTrades(market.id),
    viewerId ? positionsIn(market.id, viewerId) : Promise.resolve([]),
    viewerId ? currentBuilder() : Promise.resolve(null),
  ]);

  const held = Object.fromEntries(holdings.map((row) => [row.outcomeId, row.shares]));
  const labels = new Map(market.outcomes.map((outcome) => [outcome.id, outcome.label]));
  const priced = new Map(market.outcomes.map((outcome) => [outcome.id, outcome.price]));
  const tradable = isTradable(market.status, market.closesAt);
  const where = whereLine(market);

  return (
    <section className="mx-auto max-w-[1200px] px-4 pb-24 pt-14 sm:px-6 lg:px-12">
      <header className="rise">
        <p className="type-label flex flex-wrap items-center gap-2">
          <span>{scopeLabel(market.scope)}</span>
          {where ? (
            <>
              <span aria-hidden className="text-subtle">
                ·
              </span>
              {market.communitySlug ? (
                <Link href={`/c/${market.communitySlug}`} className="hover:text-primary-text">
                  {where}
                </Link>
              ) : (
                <span>{where}</span>
              )}
            </>
          ) : null}
          {market.status === "open" ? null : (
            <Badge tone="neutral">{statusLabel(market.status)}</Badge>
          )}
        </p>
        <h1 className="type-heading mt-3 max-w-[26ch]">{market.question}</h1>
        <p className="mt-3 max-w-[62ch] text-[0.95rem] text-muted">
          {marketRulesText(market.params, market.resolvesAt)}
        </p>
        <p className="type-data mt-2 text-[0.8rem] text-subtle tabular-nums">
          {tradable ? formatClosesIn(market.closesAt) : `closed ${stamp.format(market.closesAt)} UTC`}
          {" · settles "}
          {formatResolvesAt(market.resolvesAt)}
          {" · liquidity b="}
          {formatCredits(market.b)}
        </p>
      </header>

      <div className="signal-rail my-10" aria-hidden />

      <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:gap-12">
        <div>
          <section className="rounded-(--radius-panel) border border-border bg-surface px-5 py-4 sm:px-6">
            <h2 className="type-label">outcomes</h2>
            <ol className="mt-2 divide-y divide-border-faint">
              {market.outcomes.map((outcome) => (
                <OutcomeRow key={outcome.id} outcome={outcome} held={held[outcome.id]} />
              ))}
            </ol>
          </section>

          <section className="mt-8 rounded-(--radius-panel) border border-border bg-surface px-5 py-5 sm:px-6">
            <h2 className="type-label">price history</h2>
            <div className="mt-4">
              <PriceChart history={history} outcomes={market.outcomes} />
            </div>
          </section>

          <section className="mt-8">
            <h2 className="type-label">trades</h2>
            {tape.length === 0 ? (
              <p className="mt-4 text-[0.95rem] text-muted">
                Nobody has traded this yet. The first buy sets the price.
              </p>
            ) : (
              <table className="mt-4 w-full border-collapse text-[0.85rem]">
                <thead>
                  <tr className="type-label text-subtle">
                    <th className="py-1 text-left font-normal">when</th>
                    <th className="py-1 text-left font-normal">who</th>
                    <th className="py-1 text-left font-normal">outcome</th>
                    <th className="py-1 text-right font-normal">shares</th>
                    <th className="py-1 text-right font-normal">credits</th>
                    <th className="py-1 text-right font-normal">price</th>
                  </tr>
                </thead>
                <tbody className="type-data">
                  {tape.map((trade) => (
                    <tr key={trade.id} className="border-t border-border-faint">
                      <td className="py-1.5 pr-3 text-muted tabular-nums">
                        {stamp.format(trade.createdAt)}
                      </td>
                      <td className="py-1.5 pr-3">
                        <Link href={`/@${trade.handle}`} className="hover:text-primary-text">
                          {trade.handle}
                        </Link>
                      </td>
                      <td className="py-1.5 pr-3 text-muted">
                        {trade.side === "buy" ? "bought " : "sold "}
                        {labels.get(trade.outcomeId) ?? "unknown"}
                      </td>
                      <td className="py-1.5 pl-3 text-right tabular-nums">
                        {formatCredits(trade.shares)}
                      </td>
                      <td className="py-1.5 pl-3 text-right tabular-nums">
                        {formatDelta(trade.side === "buy" ? -trade.credits : trade.credits)}
                      </td>
                      <td className="py-1.5 pl-3 text-right tabular-nums text-cyber">
                        {formatPriceCents(trade.priceAfter)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <aside>
          <div className="rounded-(--radius-panel) border border-border bg-surface p-6">
            <h2 className="type-label">{tradable ? "trade" : "trading is closed"}</h2>
            {!tradable ? (
              <p className="mt-4 text-[0.95rem] text-muted">
                This market stopped taking trades. Positions settle from Usage at{" "}
                {stamp.format(market.resolvesAt)} UTC.
              </p>
            ) : viewerId && builder ? (
              <div className="mt-5">
                <TradeForm
                  marketId={market.id}
                  b={market.b}
                  outcomes={market.outcomes}
                  held={held}
                  balance={builder.creditBalance}
                />
              </div>
            ) : (
              <>
                <p className="mt-4 text-[0.95rem] text-muted">
                  Sign in to trade. Credits come from your own usage, so connect a machine first.
                </p>
                <Button as={Link} href={`/signin?next=/m/${market.id}`} className="mt-5">
                  Sign in with GitHub
                </Button>
              </>
            )}
          </div>

          {holdings.length > 0 ? (
            <div className="mt-6 rounded-(--radius-panel) border border-border bg-surface p-6">
              <h2 className="type-label">your position</h2>
              <table className="mt-4 w-full border-collapse text-[0.85rem]">
                <thead>
                  <tr className="type-label text-subtle">
                    <th className="py-1 text-left font-normal">outcome</th>
                    <th className="py-1 text-right font-normal">shares</th>
                    <th className="py-1 text-right font-normal">cost</th>
                    <th className="py-1 text-right font-normal">value</th>
                  </tr>
                </thead>
                <tbody className="type-data">
                  {holdings.map((row) => {
                    // What the shares are worth if sold at the current price, before impact.
                    const value = row.shares * (priced.get(row.outcomeId) ?? 0);
                    return (
                      <tr key={row.outcomeId} className="border-t border-border-faint">
                        <td className="py-1.5 pr-3">{labels.get(row.outcomeId) ?? "unknown"}</td>
                        <td className="py-1.5 pl-3 text-right tabular-nums">
                          {formatCredits(row.shares)}
                        </td>
                        <td className="py-1.5 pl-3 text-right tabular-nums">
                          {formatCredits(row.costBasis)}
                        </td>
                        <td className="py-1.5 pl-3 text-right tabular-nums text-cyber">
                          {formatCredits(value)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-4 text-[0.85rem] text-subtle">
                Value is the price right now, before your own sell moves it. A winning share pays 1
                credit.
              </p>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
