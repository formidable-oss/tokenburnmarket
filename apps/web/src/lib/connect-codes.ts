/*
  Short codes for binding a Device, and the rules that decide what a code is
  worth right now. Everything here is pure so the lifecycle can be tested
  without a database; the routes and the approval page only read and write rows.
*/

/** Ten minutes. Long enough to switch to a browser and sign in, short enough to be forgettable. */
export const CONNECT_CODE_TTL_MS = 10 * 60 * 1000;

/*
  Crockford base32 without I, L, O and U: no character can be misread as another
  when a Builder retypes the code off a terminal. Two groups of four give
  32^8 (about 1.1e12) codes, which is far more than a ten minute window can be
  guessed through, and it still reads out loud in one breath.
*/
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const GROUP = 4;
const GROUPS = 2;

/** Generate a fresh code, formatted the way it is shown and stored: `XXXX-XXXX`. */
export function generateConnectCode(randomBytes: (size: number) => Uint8Array): string {
  const bytes = randomBytes(GROUP * GROUPS);
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    if (i > 0 && i % GROUP === 0) out += "-";
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}

/*
  Codes arrive from a URL, so they may be lowercase, unhyphenated, or padded.
  Accept all of that, reject anything else. Returns the canonical form or null.
*/
export function normalizeConnectCode(raw: string): string | null {
  const compact = raw.trim().toUpperCase().replace(/-/g, "");
  if (compact.length !== GROUP * GROUPS) return null;
  for (const character of compact) {
    if (!ALPHABET.includes(character)) return null;
  }
  return `${compact.slice(0, GROUP)}-${compact.slice(GROUP)}`;
}

/** The subset of a `device_connect_codes` row the lifecycle depends on. */
export interface ConnectCodeRow {
  expiresAt: Date;
  approvedAt: Date | null;
  tokenIssuedAt: Date | null;
  deviceToken: string | null;
}

/**
 * What a code is worth right now.
 * - `pending`: waiting for a Builder to approve or reject it in the browser.
 * - `approved`: approved, and this is the one read that may take the token.
 * - `expired`: past its window, already collected, rejected, or never existed.
 *
 * Expiry is checked before approval on purpose: a code approved after it lapsed
 * is not a code we honour, and the CLI has stopped polling by then anyway.
 */
export type ConnectCodeState = "pending" | "approved" | "expired";

export function connectCodeState(row: ConnectCodeRow | null, now: Date): ConnectCodeState {
  if (!row) return "expired";
  if (now.getTime() >= row.expiresAt.getTime()) return "expired";
  if (row.tokenIssuedAt) return "expired";
  if (row.approvedAt && row.deviceToken) return "approved";
  return "pending";
}

/** Whether the browser may still act on this code. Approving a spent code is a no-op. */
export function isApprovable(row: ConnectCodeRow | null, now: Date): boolean {
  return connectCodeState(row, now) === "pending";
}

/** The instant a code created now stops working. */
export function connectCodeExpiry(now: Date): Date {
  return new Date(now.getTime() + CONNECT_CODE_TTL_MS);
}

/**
 * A Device's public key rendered for a human to compare against the one the CLI
 * printed. Four groups of four hex characters off the sha256 of the key: short
 * enough to read across a desk, long enough that a collision is not the weak
 * link (the code itself is the secret).
 */
export function formatFingerprint(digestHex: string): string {
  const head = digestHex.slice(0, 16).toUpperCase();
  return (head.match(/.{4}/g) ?? []).join(" ");
}
