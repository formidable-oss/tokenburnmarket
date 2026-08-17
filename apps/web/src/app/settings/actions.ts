"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth, signOut } from "@/auth";
import { db } from "@/db";
import { builders } from "@/db/schema";
import { normalizeCountry, normalizeXHandle } from "@/lib/profile";

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

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}
