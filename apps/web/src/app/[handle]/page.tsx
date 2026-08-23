import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { UsagePanel } from "@/components/usage/usage-panel";
import { builderByHandle, handleFromSegment } from "@/lib/builders";
import { countryByCode } from "@/lib/countries";
import { formatCredits } from "@/lib/credits";
import { profileTitle } from "@/lib/share-cards";
import { parseUsageWindow } from "@/lib/usage";
import {
  builderUsage,
  builderUsageHistory,
  cachedBurnSeasons,
} from "@/lib/usage-queries";

/*
  Public Builder profile at /@handle. This segment sits at the root, so it only
  answers when it looks like a handle; anything else falls through to a 404.
*/

async function load(segment: string) {
  const handle = handleFromSegment(decodeURIComponent(segment));
  if (!handle) return null;
  return builderByHandle(handle);
}

export async function generateMetadata({ params }: PageProps<"/[handle]">): Promise<Metadata> {
  const builder = await load((await params).handle);
  if (!builder) return { title: "Not found" };

  // The same cached read the share card uses, so the title and the card agree.
  const burn = await cachedBurnSeasons(builder.id);
  const title = profileTitle(builder.handle, burn.weekCostUsd);
  const description = `${builder.handle} on tokenburnmarket: agent usage, credits and positions.`;
  const path = `/@${builder.handle}`;

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "profile", url: path, title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

export default async function BuilderProfile({
  params,
  searchParams,
}: PageProps<"/[handle]">) {
  const builder = await load((await params).handle);
  if (!builder) notFound();

  const windowDays = parseUsageWindow((await searchParams).days);
  const region = countryByCode(builder.country);
  const session = await auth();
  // Quarantined rows are the Builder's own business until an admin queue exists.
  const isOwner = session?.user?.id === builder.id;
  const [usage, history] = await Promise.all([
    builderUsage(builder.id, { days: windowDays, includeQuarantined: isOwner }),
    builderUsageHistory(builder.id),
  ]);

  return (
    <section className="mx-auto max-w-[1200px] px-4 pb-24 pt-14 sm:px-6 lg:px-12">
      <header className="flex flex-wrap items-center gap-5">
        {builder.avatarUrl ? (
          <Image
            src={builder.avatarUrl}
            alt=""
            width={64}
            height={64}
            className="rounded-(--radius-panel) border border-border"
            unoptimized
          />
        ) : null}
        <div>
          <h1 className="type-heading">{builder.handle}</h1>
          <p className="type-data mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8rem] text-subtle">
            <span>joined {dateFormat.format(builder.createdAt)}</span>
            {region ? <span>region {region.name}</span> : null}
            {builder.xHandle ? (
              <a
                className="underline decoration-border-strong hover:text-foreground"
                href={`https://x.com/${builder.xHandle}`}
                rel="me noreferrer"
                target="_blank"
              >
                @{builder.xHandle} on X
              </a>
            ) : null}
          </p>
        </div>
        <div className="ml-auto text-right">
          <p className="type-label">credits</p>
          <p className="type-data mt-1 text-[1.6rem] leading-none text-primary tabular-nums">
            {formatCredits(builder.creditBalance)}
          </p>
        </div>
      </header>

      <div className="signal-rail my-10" aria-hidden />

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.6fr)] lg:gap-8">
        <UsagePanel
          summary={usage}
          history={history}
          windowDays={windowDays}
          isOwner={isOwner}
          profilePath={`/@${builder.handle}`}
        />

        <div className="min-w-0 rounded-(--radius-panel) border border-border bg-surface p-6 sm:p-8">
          <h2 className="type-label">positions</h2>
          <p className="mt-4 max-w-[42ch] text-[0.95rem] text-muted">
            Open bets and settled ones show up here after the first trade.
          </p>
        </div>
      </div>
    </section>
  );
}
