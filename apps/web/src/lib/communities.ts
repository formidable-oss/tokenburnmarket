/*
  Pure helpers for Communities: slugs, invite codes, and the shape of the fields a
  person types. No database here, so every rule below is unit tested.
*/

export type Normalized<T> = { ok: true; value: T } | { ok: false; error: string };

/** Slugs are lowercase words joined by single hyphens. Short enough to say out loud. */
export const SLUG_MAX = 32;
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/*
  Reserved because /c/:slug shares its namespace with routes we may add later, and
  because a community called "new" would read as a broken link in the directory.
*/
const RESERVED_SLUGS = new Set(["new", "edit", "join", "api", "settings", "admin", "c"]);

/** Turns a display name into a slug candidate. Never throws: bad input yields "". */
export function suggestSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}

/** Validates a slug a person typed. The suggestion is only a starting point. */
export function normalizeSlug(input: string | null | undefined): Normalized<string> {
  const slug = (input ?? "").trim().toLowerCase();
  if (slug === "") return { ok: false, error: "Pick a slug." };
  if (slug.length < 2 || slug.length > SLUG_MAX) {
    return { ok: false, error: `Between 2 and ${SLUG_MAX} characters.` };
  }
  if (!SLUG_PATTERN.test(slug)) {
    return { ok: false, error: "Lowercase letters, digits and hyphens, no hyphen at either end." };
  }
  if (RESERVED_SLUGS.has(slug)) return { ok: false, error: "That slug is taken." };
  return { ok: true, value: slug };
}

export const NAME_MAX = 60;
export const BIO_MAX = 280;

export function normalizeName(input: string | null | undefined): Normalized<string> {
  const name = (input ?? "").trim().replace(/\s+/g, " ");
  if (name === "") return { ok: false, error: "Give it a name." };
  if (name.length > NAME_MAX) return { ok: false, error: `Up to ${NAME_MAX} characters.` };
  return { ok: true, value: name };
}

export function normalizeBio(input: string | null | undefined): Normalized<string | null> {
  const bio = (input ?? "").trim();
  if (bio === "") return { ok: true, value: null };
  if (bio.length > BIO_MAX) return { ok: false, error: `Up to ${BIO_MAX} characters.` };
  return { ok: true, value: bio };
}

export const VISIBILITIES = ["public", "unlisted"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export function normalizeVisibility(input: string | null | undefined): Visibility {
  return input === "unlisted" ? "unlisted" : "public";
}

/*
  Invite codes are 20 characters of a Crockford-style alphabet with no vowels and no
  look-alikes, so a code can be read over a call without spelling it out. 20 chars of
  a 30 symbol alphabet is about 98 bits: guessing one is not an attack path.
*/
const CODE_ALPHABET = "0123456789bcdfghjkmnpqrstvwxyz";
export const CODE_LENGTH = 20;
const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

export function generateInviteCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  // Modulo bias over a 30 symbol alphabet is negligible next to 98 bits of entropy.
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

/** Cheap shape check so a junk URL never reaches the database. */
export function isInviteCode(input: string | null | undefined): boolean {
  return typeof input === "string" && CODE_PATTERN.test(input);
}

/*
  Rotation must produce a code the old links cannot match, so the caller gets a
  guarantee rather than a probability. The loop is theoretical insurance.
*/
export function rotateInviteCode(current: string): string {
  let next = generateInviteCode();
  while (next === current) next = generateInviteCode();
  return next;
}

/** The absolute link handed to people. Kept here so the page and the tests agree. */
export function inviteUrl(origin: string, code: string): string {
  return `${origin.replace(/\/$/, "")}/join/${code}`;
}
