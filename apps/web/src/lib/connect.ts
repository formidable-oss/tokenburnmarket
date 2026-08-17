/*
  The connect flow, server side. The CLI starts a code, a signed-in Builder
  approves or rejects it in the browser, and the CLI polls until the token is
  handed over. Pure lifecycle rules live in lib/connect-codes; this module is
  the database half.
*/
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNotNull, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { builders, deviceConnectCodes, devices } from "@/db/schema";
import {
  connectCodeExpiry,
  connectCodeState,
  formatFingerprint,
  generateConnectCode,
  normalizeConnectCode,
  type ConnectCodeState,
} from "@/lib/connect-codes";
import { issueDeviceToken } from "@/lib/device-auth";

/** A raw 32-byte Ed25519 public key, base64. The shape `@tokenburnmarket/core` emits. */
const PublicKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9+/]{43}=$/, "expected a base64 Ed25519 public key");

export const ConnectStartSchema = z
  .object({
    publicKey: PublicKeySchema,
    deviceName: z.string().trim().min(1).max(64),
  })
  .strict();

/** How a key is shown to the Builder who is deciding whether to trust it. */
export function fingerprintOf(publicKeyBase64: string): string {
  return formatFingerprint(createHash("sha256").update(publicKeyBase64).digest("hex"));
}

/**
 * Start a connect attempt. Unauthenticated: at this point we only know a public
 * key wants an owner. Retries on a code collision, which at 32^8 codes is a
 * formality but is cheap enough to keep honest.
 */
export async function startConnect(input: z.infer<typeof ConnectStartSchema>, baseUrl: string) {
  const now = new Date();
  const expiresAt = connectCodeExpiry(now);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateConnectCode((size) => new Uint8Array(randomBytes(size)));
    const [row] = await db
      .insert(deviceConnectCodes)
      .values({
        code,
        devicePubkey: input.publicKey,
        deviceName: input.deviceName,
        expiresAt,
      })
      .onConflictDoNothing({ target: deviceConnectCodes.code })
      .returning({ code: deviceConnectCodes.code });
    if (row) {
      return {
        code: row.code,
        url: `${baseUrl}/connect/${row.code}`,
        expiresAt: expiresAt.toISOString(),
      };
    }
  }
  throw new Error("could not allocate a connect code");
}

/** Read a code for display or polling. Returns null when the code is not a code at all. */
export async function readConnectCode(raw: string) {
  const code = normalizeConnectCode(raw);
  if (!code) return null;
  const [row] = await db
    .select()
    .from(deviceConnectCodes)
    .where(eq(deviceConnectCodes.code, code))
    .limit(1);
  return row ?? null;
}

export type ConnectPoll =
  | { status: Exclude<ConnectCodeState, "approved"> }
  | { status: "approved"; deviceId: string; deviceToken: string; handle: string };

/**
 * The polling read. Taking the token is the single UPDATE that clears it, so two
 * pollers racing cannot both walk away with a credential: the loser sees
 * `expired`, which is the truth for a code that has already been spent.
 */
export async function claimConnectCode(raw: string, now = new Date()): Promise<ConnectPoll> {
  const row = await readConnectCode(raw);
  if (!row) return { status: "expired" };
  const state = connectCodeState(row, now);
  if (state !== "approved") return { status: state };

  const [claimed] = await db
    .update(deviceConnectCodes)
    .set({ deviceToken: null, tokenIssuedAt: now })
    .where(and(eq(deviceConnectCodes.code, row.code), isNotNull(deviceConnectCodes.deviceToken)))
    .returning({ deviceId: deviceConnectCodes.deviceId, builderId: deviceConnectCodes.builderId });

  if (!claimed?.deviceId || !claimed.builderId || !row.deviceToken) return { status: "expired" };

  const [builder] = await db
    .select({ handle: builders.handle })
    .from(builders)
    .where(eq(builders.id, claimed.builderId))
    .limit(1);
  if (!builder) return { status: "expired" };

  return {
    status: "approved",
    deviceId: claimed.deviceId,
    deviceToken: row.deviceToken,
    handle: builder.handle,
  };
}

/**
 * Bind the pending key to this Builder: create the Device, mint its token, and
 * park the token on the code row for the Collector to collect once.
 * Approving the same public key twice reuses the Device row, so reconnecting a
 * machine does not litter /settings with duplicates.
 */
export async function approveConnectCode(raw: string, builderId: string, now = new Date()) {
  const row = await readConnectCode(raw);
  if (!row || connectCodeState(row, now) !== "pending") return false;

  const [device] = await db
    .insert(devices)
    .values({ builderId, name: row.deviceName, publicKey: row.devicePubkey })
    .onConflictDoUpdate({
      target: devices.publicKey,
      // A re-approval also un-revokes: the Builder just said yes to this machine again.
      set: { builderId, name: row.deviceName, revokedAt: null },
    })
    .returning({ id: devices.id });
  if (!device) return false;

  const deviceToken = await issueDeviceToken(device.id);
  await db
    .update(deviceConnectCodes)
    .set({ builderId, deviceId: device.id, deviceToken, approvedAt: now })
    .where(eq(deviceConnectCodes.code, row.code));
  return true;
}

/** Reject: the row goes away, so the Collector sees exactly what it sees for an expired code. */
export async function rejectConnectCode(raw: string) {
  const code = normalizeConnectCode(raw);
  if (!code) return false;
  await db.delete(deviceConnectCodes).where(eq(deviceConnectCodes.code, code));
  return true;
}

/** Housekeeping for lapsed codes. Called opportunistically when a new one is started. */
export async function pruneExpiredConnectCodes(now = new Date()) {
  await db.delete(deviceConnectCodes).where(lt(deviceConnectCodes.expiresAt, now));
}
