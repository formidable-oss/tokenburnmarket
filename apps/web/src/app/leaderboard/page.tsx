import type { Metadata } from "next";
import { RegionBoard } from "@/components/leaderboard/region-board";
import { parseBoardQuery } from "@/lib/leaderboard";
import { WORLD } from "@/lib/regions";
import { boardTitle } from "@/lib/share-cards";

export async function generateMetadata({
  searchParams,
}: PageProps<"/leaderboard">): Promise<Metadata> {
  const { period } = parseBoardQuery(await searchParams);
  const title = boardTitle(WORLD.name, period);
  const description =
    "Who is burning the most on AI coding agents, by week, month or all time. World, continent and country boards.";

  return {
    title,
    description,
    alternates: { canonical: "/leaderboard" },
    openGraph: { type: "website", url: "/leaderboard", title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function LeaderboardPage({ searchParams }: PageProps<"/leaderboard">) {
  return <RegionBoard region={WORLD} query={parseBoardQuery(await searchParams)} />;
}
