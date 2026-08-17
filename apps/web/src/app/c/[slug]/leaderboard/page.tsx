import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CommunityBoard } from "@/components/leaderboard/community-board";
import { communityBySlug } from "@/lib/community-queries";
import { parseBoardQuery } from "@/lib/leaderboard";

/*
  The full Community board. The panel on /c/[slug] is the same component with a
  shorter limit, so the two can never disagree about a rank.
*/

export async function generateMetadata({
  params,
}: PageProps<"/c/[slug]/leaderboard">): Promise<Metadata> {
  const community = await communityBySlug((await params).slug);
  if (!community) return { title: "Not found" };
  return {
    title: `${community.name} leaderboard`,
    description: `Who is burning the most in ${community.name}.`,
    alternates:
      community.visibility === "public"
        ? { canonical: `/c/${community.slug}/leaderboard` }
        : undefined,
    robots: community.visibility === "unlisted" ? { index: false, follow: false } : undefined,
  };
}

export default async function CommunityLeaderboardPage({
  params,
  searchParams,
}: PageProps<"/c/[slug]/leaderboard">) {
  const community = await communityBySlug((await params).slug);
  if (!community) notFound();

  return (
    <section className="mx-auto max-w-[1200px] px-4 pb-24 pt-14 sm:px-6 lg:px-12">
      <header>
        <p className="type-label">community leaderboard</p>
        <h1 className="type-heading mt-3">{community.name}</h1>
        <Link
          href={`/c/${community.slug}`}
          className="type-data mt-2 inline-block text-[0.8rem] text-subtle hover:text-foreground"
        >
          back to /c/{community.slug}
        </Link>
      </header>

      <div className="signal-rail my-10" aria-hidden />

      <CommunityBoard
        community={community}
        query={parseBoardQuery(await searchParams)}
        showSwitches
      />

      <p className="mt-6 max-w-[56ch] text-[0.85rem] text-subtle">
        Reported means the agent gives us no message identifiers to check against. Quarantined days
        are left out entirely.
      </p>
    </section>
  );
}
