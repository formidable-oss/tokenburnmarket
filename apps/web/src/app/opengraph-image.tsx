import { CARD_SIZE, renderCard } from "./og-card";
import { siteCard } from "@/lib/share-cards";

export const alt = "tokenburnmarket. Bet your burn.";
export const size = CARD_SIZE;
export const contentType = "image/png";

export default function OpenGraphImage() {
  return renderCard(siteCard());
}
