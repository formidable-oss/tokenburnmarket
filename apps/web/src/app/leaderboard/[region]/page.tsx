import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { RegionBoard } from "@/components/leaderboard/region-board";
import { parseBoardQuery } from "@/lib/leaderboard";
import { regionBySlug } from "@/lib/regions";

/*
  A region board at its own URL, so a continent or a country can be linked and
  shared. `world` lives at /leaderboard, so this route sends it there rather
  than answering on two addresses.
*/

export async function generateMetadata({
  params,
}: PageProps<"/leaderboard/[region]">): Promise<Metadata> {
  const region = regionBySlug((await params).region);
  if (!region) return { title: "Not found" };
  return {
    title: `${region.name} leaderboard`,
    description: `Who is burning the most on AI coding agents in ${region.name}.`,
    alternates: { canonical: `/leaderboard/${region.slug}` },
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
