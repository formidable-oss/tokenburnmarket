import type { Metadata } from "next";
import { RegionBoard } from "@/components/leaderboard/region-board";
import { parseBoardQuery } from "@/lib/leaderboard";
import { WORLD } from "@/lib/regions";

export const metadata: Metadata = {
  title: "Leaderboard",
  description:
    "Who is burning the most on AI coding agents, by week, month or all time. World, continent and country boards.",
  alternates: { canonical: "/leaderboard" },
};

export default async function LeaderboardPage({ searchParams }: PageProps<"/leaderboard">) {
  return <RegionBoard region={WORLD} query={parseBoardQuery(await searchParams)} />;
}
