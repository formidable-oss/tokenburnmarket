import { CARD_SIZE, renderCard } from "./og-card";

export const alt = "tokenburnmarket. Bet your burn.";
export const size = CARD_SIZE;
export const contentType = "image/png";

export default function TwitterImage() {
  return renderCard();
}
