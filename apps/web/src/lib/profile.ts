/*
  Pure normalisation for the Builder fields a person can edit.
  Both helpers take raw form input and return either a stored value or a message
  that is safe to show next to the field. Empty input always means "not set".
*/
import { isCountryCode } from "./countries";

export type Normalized<T> = { ok: true; value: T } | { ok: false; error: string };

/** X handles are 1 to 15 characters of letters, digits and underscore. Stored without the @. */
export function normalizeXHandle(input: string | null | undefined): Normalized<string | null> {
  const trimmed = (input ?? "").trim().replace(/^@/, "");
  if (trimmed === "") return { ok: true, value: null };
  if (!/^[A-Za-z0-9_]{1,15}$/.test(trimmed)) {
    return { ok: false, error: "Letters, digits and underscore, up to 15 characters." };
  }
  return { ok: true, value: trimmed };
}

/** Region is an ISO 3166-1 alpha-2 code. Anything outside the list is rejected, not coerced. */
export function normalizeCountry(input: string | null | undefined): Normalized<string | null> {
  const trimmed = (input ?? "").trim().toUpperCase();
  if (trimmed === "") return { ok: true, value: null };
  if (!isCountryCode(trimmed)) return { ok: false, error: "Pick a country from the list." };
  return { ok: true, value: trimmed };
}

/** Keeps post-sign-in redirects on this site: a single leading slash, no protocol. */
export function safeInternalPath(input: string | null | undefined, fallback = "/"): string {
  if (!input || !input.startsWith("/") || input.startsWith("//")) return fallback;
  return input;
}
