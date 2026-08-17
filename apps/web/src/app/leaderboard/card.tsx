import { CARD_SIZE, renderCard } from "@/app/og-card";
import { boardShareCard } from "@/lib/board-card";
import { scopeForRegion } from "@/lib/leaderboard-queries";
import { WORLD } from "@/lib/regions";

/** The world board lives at /leaderboard, so its card does too. */
export const alt = "The world leaderboard on tokenburnmarket.";
export const size = CARD_SIZE;
export const contentType = "image/png";

export default async function WorldBoardShareCard() {
  return renderCard(await boardShareCard(scopeForRegion(WORLD), WORLD.name, "region"));
}
