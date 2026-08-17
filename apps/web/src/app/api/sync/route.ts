/*
  POST /api/sync: one signed upload from a Device.

  Two credentials, on purpose. The bearer token says which Device is calling and
  whether it is still allowed; the Ed25519 signature over the canonical JSON says
  the body is the one that Device produced. A stolen token alone cannot forge
  Usage, because the private key never leaves the machine.
*/
import { verifySyncBody } from "@tokenburnmarket/core";
import { requireDevice } from "@/lib/device-auth";
import { applySync, isFreshSync } from "@/lib/sync";
import { drizzleSyncStore } from "@/lib/sync-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireDevice(request);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const verified = await verifySyncBody(auth.device.publicKey, body);
  if (!verified.ok) {
    const status = verified.error === "bad_signature" ? 401 : 400;
    return Response.json({ error: verified.error }, { status });
  }

  // The token names the Device; the payload must agree, or the signature is
  // being replayed under someone else's credential.
  if (verified.payload.deviceId !== auth.device.id) {
    return Response.json({ error: "device_mismatch" }, { status: 403 });
  }

  const now = new Date();
  if (!isFreshSync(verified.payload, now)) {
    return Response.json({ error: "stale_payload" }, { status: 400 });
  }

  const result = await applySync(
    drizzleSyncStore,
    {
      id: auth.device.id,
      builderId: auth.device.builderId,
      watermarkDay: auth.device.lastSyncedDay,
    },
    verified.payload,
    now,
  );

  return Response.json(result, { status: 200 });
}
