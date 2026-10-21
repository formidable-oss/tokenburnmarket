/*
  POST /api/sync: one signed upload from a Device.

  Two credentials, on purpose. The bearer token says which Device is calling and
  whether it is still allowed; the Ed25519 signature over the canonical JSON says
  the body is the one that Device produced. A stolen token alone cannot forge
  Usage, because the private key never leaves the machine.

  Automatic Syncs are only taken inside a Sync Slot window (ADR 0005), and that
  check comes before anything touches the database: a Collector knocking at
  the wrong time must not wake it. Collectors from before the slots send no
  trigger and are treated as automatic.
*/
import {
  SYNC_SLOT_TIMES,
  SYNC_TRIGGER_HEADER,
  inSyncWindow,
  nextSyncSlot,
  verifySyncBody,
} from "@tokenburnmarket/core";
import { revalidatePath, revalidateTag } from "next/cache";
import { requireDevice } from "@/lib/device-auth";
import { applySync, isFreshSync } from "@/lib/sync";
import { drizzleSyncStore } from "@/lib/sync-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const now = new Date();
  if (request.headers.get(SYNC_TRIGGER_HEADER) !== "manual" && !inSyncWindow(now)) {
    const next = nextSyncSlot(now);
    return Response.json(
      {
        error: "outside_sync_slot",
        message: `Automatic syncs run at ${SYNC_SLOT_TIMES}. The next one is ${next.toISOString().slice(11, 16)} UTC. Update with npm i -g tokenburnmarket@latest to sync by hand at any time.`,
      },
      {
        status: 429,
        headers: { "retry-after": String(Math.ceil((next.getTime() - now.getTime()) / 1000)) },
      },
    );
  }

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

  // The profile is the first place a person looks after connecting, so the
  // sync they just watched finish is what it shows. Boards are cached for a
  // whole slot and only change when Syncs land, so they are marked stale here
  // too: Syncs arrive in bursts a few times a day, which keeps the purges rare.
  revalidatePath(`/@${auth.handle}`);
  revalidateTag("leaderboard", "max");

  return Response.json(result, { status: 200 });
}
