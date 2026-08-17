import { CARD_SIZE, renderCard } from "@/app/og-card";
import { marketById, type MarketDetail } from "@/lib/market-queries";
import { formatClosesIn, isTradable, scopeLabel, statusLabel } from "@/lib/markets";
import { marketCard, siteCard } from "@/lib/share-cards";

/*
  The Market share card: the question, the three dearest Outcomes, and when it
  closes. Prices are read the same way the page reads them, so a card and the
  page it links to never quote two different numbers.
*/
export const alt = "A market on tokenburnmarket.";
export const size = CARD_SIZE;
export const contentType = "image/png";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Scope, and the audience's name where there is one. Global Markets have none. */
function scopeLine(market: MarketDetail): string {
  const where =
    market.scope === "community" ? market.communityName : market.scope === "country" ? market.country : null;
  return where ? `${scopeLabel(market.scope)} · ${where}` : scopeLabel(market.scope);
}

export default async function MarketShareCard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const market = UUID.test(id) ? await marketById(id) : null;
  if (!market) return renderCard(siteCard());

  return renderCard(
    marketCard({
      question: market.question,
      scopeLine: scopeLine(market),
      closesLine: isTradable(market.status, market.closesAt)
        ? formatClosesIn(market.closesAt)
        : statusLabel(market.status),
      outcomes: market.outcomes,
    }),
  );
}
