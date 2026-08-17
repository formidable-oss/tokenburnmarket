import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MODEL_RACE_MODELS } from "@tokenburnmarket/core";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { countries } from "@/lib/countries";
import { communitiesForMarkets, modelsInPlay } from "@/lib/market-queries";
import { TEMPLATE_CARDS, raceModels } from "@/lib/market-templates";
import { TemplateForm } from "./template-form";

export const metadata: Metadata = {
  title: "New market",
  description: "Open a market on future usage.",
  robots: { index: false, follow: false },
};

/*
  Opening a Market is picking a template, not writing a question: the question,
  the outcomes and the rules sentence all come from the template, so two markets
  of the same kind read the same way and a resolver can settle both.
*/
export default async function NewMarketPage({ searchParams }: PageProps<"/markets/new">) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin?next=/markets/new");
  const builderId = session.user.id;
  const admin = isAdmin(session.user.handle);

  const { template } = await searchParams;
  const picked = TEMPLATE_CARDS.find(
    (card) => card.template === template && (admin || !card.adminOnly),
  );

  const communities = (await communitiesForMarkets({ builderId })).filter(
    (community) => community.membersCanCreate || community.ownerId === builderId || admin,
  );
  const models =
    picked?.template === "model_race" ? raceModels(await modelsInPlay(MODEL_RACE_MODELS)) : [];

  return (
    <section className="mx-auto grid max-w-[1200px] gap-10 px-4 pb-24 pt-14 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16 lg:px-12">
      <div>
        <p className="type-label">new market</p>
        <h1 className="type-heading mt-3">{picked ? picked.title : "Pick a question."}</h1>
        <p className="mt-3 max-w-[46ch] text-[0.95rem] text-muted">
          {picked
            ? picked.blurb
            : "Every market is one of four questions about usage. Pick one and fill in who and when."}
        </p>

        {picked ? (
          <>
            <TemplateForm
              template={picked.template}
              communities={communities.map((community) => ({
                id: community.id,
                name: community.name,
                members: community.members,
              }))}
              models={models}
              countries={countries}
            />
            <Link href="/markets/new" className="type-label mt-8 inline-block text-subtle hover:text-foreground">
              back to templates
            </Link>
          </>
        ) : (
          <ul className="mt-8 divide-y divide-border-faint rounded-(--radius-panel) border border-border bg-surface">
            {TEMPLATE_CARDS.map((card) => {
              const locked = card.adminOnly && !admin;
              return (
                <li key={card.template} className="px-5 py-4 sm:px-6">
                  {locked ? (
                    <p className="type-label text-subtle">
                      {card.title} <span className="ml-2">admins only</span>
                    </p>
                  ) : (
                    <Link
                      href={`/markets/new?template=${card.template}`}
                      className="type-label text-foreground hover:text-primary-text"
                    >
                      {card.title}
                    </Link>
                  )}
                  <p className="mt-2 text-[0.9rem] text-muted">{card.blurb}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <aside className="rounded-(--radius-panel) border border-border bg-surface p-6 sm:p-8 lg:mt-16">
        <h2 className="type-label">how pricing works</h2>
        <ul className="mt-4 space-y-3 text-[0.95rem] text-muted">
          <li>Prices are probabilities. They start even and move as people trade.</li>
          <li>Buying an outcome raises its price and lowers the others.</li>
          <li>Liquidity is set from how many people can trade it, and never changes after.</li>
          <li>Trading stops when the week ends. Usage is read a day later, so a late sync counts.</li>
        </ul>
        {communities.length === 0 ? (
          <p className="mt-6 text-[0.9rem] text-subtle">
            Community markets need a community.{" "}
            <Link href="/communities" className="hover:text-foreground">
              Find one
            </Link>
            .
          </p>
        ) : null}
      </aside>
    </section>
  );
}
