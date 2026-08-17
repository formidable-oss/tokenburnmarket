import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { RegionBoard } from "@/components/leaderboard/region-board";
import { parseBoardQuery } from "@/lib/leaderboard";
import { regionBySlug } from "@/lib/regions";
import { boardTitle } from "@/lib/share-cards";

/*
  A region board at its own URL, so a continent or a country can be linked and
  shared. `world` lives at /leaderboard, so this route sends it there rather
  than answering on two addresses.
*/

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<"/leaderboard/[region]">): Promise<Metadata> {
  const region = regionBySlug((await params).region);
  if (!region) return { title: "Not found" };

  const { period } = parseBoardQuery(await searchParams);
  const title = boardTitle(region.name, period);
  const description = `Who is burning the most on AI coding agents in ${region.name}.`;
  // Every Season of a board is the same board, so the plain path is the one canonical URL.
  const path = `/leaderboard/${region.slug}`;

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", url: path, title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function RegionLeaderboardPage({
  params,
  searchParams,
}: PageProps<"/leaderboard/[region]">) {
  const { region: slug } = await params;
  const region = regionBySlug(slug);
  if (!region) notFound();
  if (region.slug === "world") redirect("/leaderboard");

  return <RegionBoard region={region} query={parseBoardQuery(await searchParams)} />;
}
