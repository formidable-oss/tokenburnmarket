import { sql } from "drizzle-orm";
import { db } from "@/db";
import { builders } from "@/db/schema";

/*
  GitHub logins are case insensitive, so /@Alex and /@alex are the same Builder.
  The comparison is done in SQL to keep it a single index-free equality on lower(handle).
*/
export async function builderByHandle(handle: string) {
  const [builder] = await db
    .select()
    .from(builders)
    .where(sql`lower(${builders.handle}) = ${handle.toLowerCase()}`)
    .limit(1);
  return builder ?? null;
}

/** Handles come off the URL as "@login". Returns the login, or null when the shape is wrong. */
export function handleFromSegment(segment: string): string | null {
  if (!segment.startsWith("@")) return null;
  const handle = segment.slice(1);
  return /^[A-Za-z0-9-]{1,39}$/.test(handle) ? handle : null;
}
