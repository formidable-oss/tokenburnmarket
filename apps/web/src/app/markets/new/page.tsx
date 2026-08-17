import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { communitiesForBuilder } from "@/lib/market-queries";
import { NewMarketForm } from "./new-market-form";

export const metadata: Metadata = {
  title: "New market",
  description: "Open a market on future usage.",
  robots: { index: false, follow: false },
};

export default async function NewMarketPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin?next=/markets/new");

  // The Communities the Builder belongs to are the only ones they may open a Market in.
  const communities = await communitiesForBuilder(session.user.id);

  return (
    <section className="mx-auto grid max-w-[1200px] gap-10 px-4 pb-24 pt-14 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16 lg:px-12">
      <div>
        <p className="type-label">new market</p>
        <h1 className="type-heading mt-3">Ask a question.</h1>
        <p className="mt-3 max-w-[46ch] text-[0.95rem] text-muted">
          People trade credits on the answer. The house is always the counterparty, so there is
          always a price, and a winning share pays 1 credit.
        </p>
        <NewMarketForm communities={communities} />
      </div>

      <aside className="rounded-(--radius-panel) border border-border bg-surface p-6 sm:p-8 lg:mt-16">
        <h2 className="type-label">how pricing works</h2>
        <ul className="mt-4 space-y-3 text-[0.95rem] text-muted">
          <li>Prices are probabilities. They start even and move as people trade.</li>
          <li>Buying an outcome raises its price and lowers the others.</li>
          <li>Liquidity is set from how many people can trade it, and never changes after.</li>
          <li>You can sell back to the market at any time before it closes.</li>
        </ul>
      </aside>
    </section>
  );
}
