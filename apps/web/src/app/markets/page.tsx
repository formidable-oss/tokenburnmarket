import type { Metadata } from "next";
import Link from "next/link";
import { auth, currentBuilder } from "@/auth";
import { MarketList } from "@/components/markets/market-list";
import { Button } from "@/components/ui/button";
import { openMarketsFor } from "@/lib/market-queries";

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
  const markets = await openMarketsFor(viewerId, builder?.country ?? null);

  return (
    <section className="mx-auto max-w-[1200px] px-4 pb-24 pt-14 sm:px-6 lg:px-12">
      <header className="rise flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="type-label">markets</p>
          <h1 className="type-heading mt-3">Bet on the burn.</h1>
          <p className="mt-3 max-w-[52ch] text-[0.95rem] text-muted">
            Questions about future usage, priced by a market maker that is always willing to trade.
            Credits only. A winning share pays 1 credit.
          </p>
        </div>
        {viewerId ? (
          <Button as={Link} href="/markets/new" variant="secondary">
            Open a market
          </Button>
        ) : null}
      </header>

      <div className="signal-rail my-10" aria-hidden />

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

      <p className="mt-8 max-w-[52ch] text-[0.85rem] text-subtle">
        Prices read as probabilities and always add up to 1. They move as people trade, and they are
        an opinion, not a forecast.
      </p>
    </section>
  );
}
