/*
  Device tokens: the credential a Collector sends on every request after connect.

  The token is a JWT signed with AUTH_SECRET, the same secret behind the browser
  session, and it carries nothing but the Device id. Everything else (the owner,
  the name, whether it is still allowed) is read from the row, so revoking a
  Device takes effect on its next request without any token bookkeeping.

  The token does not expire. A Device is a machine, not a session; `revoked_at`
  is the off switch, and it is the one a Builder can actually reach.
*/
import { and, eq, isNull } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import { db } from "@/db";
import { builders, devices } from "@/db/schema";
import type { Device } from "@/db/schema";

const ISSUER = "tokenburnmarket";
const AUDIENCE = "tokenburnmarket/device";
const ALGORITHM = "HS256";

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not set. It signs both sessions and device tokens.");
  return new TextEncoder().encode(value);
}

/** Mint the token handed to a Collector once, at the end of the connect flow. */
export async function issueDeviceToken(deviceId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(deviceId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .sign(secret());
}

export type DeviceAuth =
  | { ok: true; device: Device; handle: string }
  | { ok: false; status: 401 | 403; error: "missing_token" | "bad_token" | "revoked" };

/** Pull the bearer token off a request. Exported for tests; the header shape is the contract. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, ...rest] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer") return null;
  const token = rest.join(" ").trim();
  return token.length > 0 ? token : null;
}

/**
 * Authenticate a Collector request. Returns the Device row and its Builder's
 * handle, or the status a route should answer with. Never throws on bad input:
 * a malformed token and a forged one are the same 401, and a revoked Device is
 * a 403 so the Collector can tell the two apart and stop retrying.
 */
export async function requireDevice(request: Request): Promise<DeviceAuth> {
  const token = bearerToken(request);
  if (!token) return { ok: false, status: 401, error: "missing_token" };

  let deviceId: string;
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: [ALGORITHM],
    });
    if (!payload.sub) return { ok: false, status: 401, error: "bad_token" };
    deviceId = payload.sub;
  } catch {
    return { ok: false, status: 401, error: "bad_token" };
  }

  const [row] = await db
    .select({ device: devices, handle: builders.handle })
    .from(devices)
    .innerJoin(builders, eq(builders.id, devices.builderId))
    .where(eq(devices.id, deviceId))
    .limit(1);

  // A token for a Device that no longer exists is indistinguishable from a forged one.
  if (!row) return { ok: false, status: 401, error: "bad_token" };
  if (row.device.revokedAt) return { ok: false, status: 403, error: "revoked" };

  return { ok: true, device: row.device, handle: row.handle };
}

/** The Devices a Builder still owns, newest first. Revoked Devices are kept but listed last. */
export async function activeDevicesFor(builderId: string) {
  return db
    .select()
    .from(devices)
    .where(and(eq(devices.builderId, builderId), isNull(devices.revokedAt)))
    .orderBy(devices.createdAt);
}
