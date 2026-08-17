import { CARD_SIZE, renderCard } from "@/app/og-card";
import { builderByHandle, handleFromSegment } from "@/lib/builders";
import { profileCard, siteCard } from "@/lib/share-cards";
import { cachedBurnSeasons } from "@/lib/usage-queries";

/*
  The profile share card. No avatar on purpose: the picture belongs to GitHub,
  and a card that fetches a remote image is a card that renders slowly.
*/
export const alt = "A builder on tokenburnmarket.";
export const size = CARD_SIZE;
export const contentType = "image/png";

export default async function ProfileShareCard({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const segment = handleFromSegment(decodeURIComponent((await params).handle));
  const builder = segment ? await builderByHandle(segment) : null;
  // A card is fetched by crawlers for URLs that no longer resolve; the site card is the honest answer.
  if (!builder) return renderCard(siteCard());

  const burn = await cachedBurnSeasons(builder.id);
  return renderCard(
    profileCard({
      handle: builder.handle,
      weekCostUsd: burn.weekCostUsd,
      monthCostUsd: burn.monthCostUsd,
      creditBalance: builder.creditBalance,
      trust: burn.trust,
    }),
  );
}
