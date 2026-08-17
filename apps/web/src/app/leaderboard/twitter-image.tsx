import { CARD_SIZE } from "@/app/og-card";
import ShareCard, { alt as cardAlt } from "./card";

export const alt = cardAlt;
export const size = CARD_SIZE;
export const contentType = "image/png";

export default ShareCard;

// Reads the live board; never prerender at build time (no DATABASE_URL in CI).
export const dynamic = "force-dynamic";
