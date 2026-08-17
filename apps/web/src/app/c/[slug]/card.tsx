import { CARD_SIZE, renderCard } from "@/app/og-card";
import { boardShareCard } from "@/lib/board-card";
import { communityBySlug } from "@/lib/community-queries";
import { siteCard } from "@/lib/share-cards";

/*
  The Community board card. Unlisted Communities get one too: the URL is the
  secret, and a member pasting the link into a chat should still see the board.
*/
export const alt = "A community leaderboard on tokenburnmarket.";
export const size = CARD_SIZE;
export const contentType = "image/png";

export default async function CommunityShareCard({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const community = await communityBySlug((await params).slug);
  if (!community) return renderCard(siteCard());
  return renderCard(
    await boardShareCard({ kind: "community", communityId: community.id }, community.name, "community"),
  );
}
