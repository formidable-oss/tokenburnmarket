import type { Metadata } from "next";
import Link from "next/link";
import { auth, currentBuilder } from "@/auth";
import { BetsPanel } from "@/components/markets/bets-panel";
import { HowToPlay } from "@/components/markets/how-to-play";
import { MarketList } from "@/components/markets/market-list";
import { SettledList } from "@/components/markets/settled-list";
import { Button } from "@/components/ui/button";
import { betsFor, openMarketsFor, recentlySettledFor } from "@/lib/market-queries";

/*
  Every Market a viewer can trade: global, their Region's, and the ones inside
  the Communities they belong to. Signed out, that is the global ones, which is
  enough to see what the page is for.
*/

export const metadata: Metadata = {
  title: "Markets",
  description: "Open markets on token burn, priced by a house-backed market maker.",
  alternates: { canonical: "/markets" },
};

export default async function MarketsPage() {
  const session = await auth();
  const viewerId = session?.user?.id ?? null;
  const builder = viewerId ? await currentBuilder() : null;
  const country = builder?.country ?? null;
  const [markets, settled, bets] = await Promise.all([
    openMarketsFor(viewerId, country),
    recentlySettledFor(viewerId, country),
    builder ? betsFor(builder.id, { limit: 200 }) : Promise.resolve([]),
  ]);
  // The rules fold away once someone has been paid by them.
  const experienced = bets.some((bet) => bet.net !== null);

  return (
    <section className="mx-auto max-w-[1200px] px-4 pb-24 pt-14 sm:px-6 lg:px-12">
      <header className="rise flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="type-label">markets</p>
          <h1 className="type-heading mt-3">Bet on the burn.</h1>
          <p className="mt-3 max-w-[52ch] text-[0.95rem] text-muted">
            Back the builder or model you think burns most. Every share pays 1 credit if its
            outcome wins, so the cheaper the price, the bigger the payout.
          </p>
        </div>
        {viewerId ? (
          <Button as={Link} href="/markets/new" variant="secondary">
            Open a market
          </Button>
        ) : null}
      </header>

      <div className="signal-rail my-10" aria-hidden />

      <HowToPlay open={!experienced} />

      <h2 className="type-label mt-10">open</h2>
      <div className="mt-4">
        {markets.length === 0 ? (
          <p className="max-w-[52ch] text-[0.95rem] text-muted">
            Nothing open right now.{" "}
            {viewerId
              ? "Open one, or join a community and trade theirs."
              : "Sign in to see the markets inside your communities."}
          </p>
        ) : (
          <MarketList markets={markets} />
        )}
      </div>

      <div className="signal-rail my-10" aria-hidden />

      <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:gap-12">
        <SettledList markets={settled} />
        {builder ? (
          <div className="min-w-0 lg:self-start">
            <BetsPanel
              bets={bets}
              isOwner
              handle={builder.handle}
              limit={5}
              moreHref={`/@${builder.handle}`}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
