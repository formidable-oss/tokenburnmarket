import { CARD_SIZE, renderCard } from "@/app/og-card";
import { boardShareCard } from "@/lib/board-card";
import { scopeForRegion } from "@/lib/leaderboard-queries";
import { regionBySlug } from "@/lib/regions";
import { siteCard } from "@/lib/share-cards";

/** The region board card: top five, this week, by cost. */
export const alt = "A region leaderboard on tokenburnmarket.";
export const size = CARD_SIZE;
export const contentType = "image/png";

export default async function RegionBoardShareCard({
  params,
}: {
  params: Promise<{ region: string }>;
}) {
  const region = regionBySlug((await params).region);
  if (!region) return renderCard(siteCard());
  return renderCard(await boardShareCard(scopeForRegion(region), region.name, "region"));
}
