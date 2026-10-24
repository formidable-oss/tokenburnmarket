"use server";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath, revalidateTag } from "next/cache";
import { auth, signOut } from "@/auth";
import { db } from "@/db";
import { builders, devices } from "@/db/schema";
import { OWN_MACHINE } from "@/lib/device-queries";
import { normalizeCountry, normalizeXHandle } from "@/lib/profile";
import { regroupMachines } from "@/lib/sync";
import { drizzleSyncStore } from "@/lib/sync-store";

export type SettingsState = {
  status: "idle" | "saved" | "error";
  message?: string;
  fieldErrors?: { country?: string; xHandle?: string };
};

/*
  Saves the two fields a Builder owns. Validation lives in lib/profile so it can be
  tested without a database; this action only decides what to write and what to say.
*/
export async function saveSettings(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const session = await auth();
  if (!session?.user?.id) return { status: "error", message: "Sign in again to save." };

  const country = normalizeCountry(formData.get("country")?.toString());
  const xHandle = normalizeXHandle(formData.get("xHandle")?.toString());

  if (!country.ok || !xHandle.ok) {
    return {
      status: "error",
      message: "Nothing saved.",
      fieldErrors: {
        country: country.ok ? undefined : country.error,
        xHandle: xHandle.ok ? undefined : xHandle.error,
      },
    };
  }

  await db
    .update(builders)
    .set({ country: country.value, xHandle: xHandle.value })
    .where(eq(builders.id, session.user.id));

  revalidatePath("/settings");
  revalidatePath(`/@${session.user.handle}`);
  return { status: "saved", message: "Saved." };
}

/*
  Revoking is a tombstone, not a delete: the Usage a Device already uploaded stays
  attributed to it, and `requireDevice` refuses the Device on its next request.
  Scoped to the signed-in Builder, so a stolen device id revokes nothing.
*/
export async function revokeDevice(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) return;

  const deviceId = formData.get("deviceId")?.toString();
  if (!deviceId) return;

  await db
    .update(devices)
    .set({ revokedAt: new Date() })
    .where(and(eq(devices.id, deviceId), eq(devices.builderId, session.user.id)));

  revalidatePath("/settings");
}

/*
  Marks a Device as the same machine as another Device, or as a machine of its
  own. A machine counts each day once (ADR 0006), so every machine of this
  Builder is recounted here, and boards and the profile are marked stale.
  Joining moves every Device already counted as this machine along with it.
  The recount covers all machines and runs even when nothing moved, so saving
  again repairs a run that stopped halfway. Scoped to the signed-in Builder, so
  a stolen device id moves nothing.
*/
export async function setDeviceMachine(formData: FormData) {
  const session = await auth();
  const builderId = session?.user?.id;
  if (!builderId) return;

  const deviceId = formData.get("deviceId")?.toString();
  const target = formData.get("machine")?.toString();
  if (!deviceId || !target) return;

  const owned = await db
    .select({ id: devices.id, machineId: devices.machineId })
    .from(devices)
    .where(eq(devices.builderId, builderId));
  const device = owned.find((row) => row.id === deviceId);
  if (!device) return;

  if (target === OWN_MACHINE) {
    if (owned.some((row) => row.id !== deviceId && row.machineId === device.machineId)) {
      await db
        .update(devices)
        .set({ machineId: randomUUID() })
        .where(and(eq(devices.id, deviceId), eq(devices.builderId, builderId)));
    }
  } else {
    const other = owned.find((row) => row.id === target && row.id !== deviceId);
    if (!other) return;
    if (other.machineId !== device.machineId) {
      await db
        .update(devices)
        .set({ machineId: other.machineId })
        .where(and(eq(devices.builderId, builderId), eq(devices.machineId, device.machineId)));
    }
  }

  const machines = await drizzleSyncStore.builderMachines(builderId);
  await regroupMachines(drizzleSyncStore, builderId, machines, new Date());
  revalidatePath("/settings");
  revalidatePath(`/@${session.user.handle}`);
  revalidateTag("leaderboard", "max");
}

/*
  Lets a Device place bets, or stops it. Trading is off for a new Device until
  its Builder turns it on, because a connect code can be approved for a
  machine they do not own (ADR 0007). Scoped to the signed-in Builder.
*/
export async function setDeviceTrading(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) return;

  const deviceId = formData.get("deviceId")?.toString();
  if (!deviceId) return;

  await db
    .update(devices)
    .set({ canTrade: formData.get("canTrade") === "on" })
    .where(and(eq(devices.id, deviceId), eq(devices.builderId, session.user.id)));
  revalidatePath("/settings");
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}
