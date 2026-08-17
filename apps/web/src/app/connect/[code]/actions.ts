"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { approveConnectCode, rejectConnectCode } from "@/lib/connect";
import { normalizeConnectCode } from "@/lib/connect-codes";

/*
  Both decisions are server actions on a plain form, so the page works before
  hydration. The code travels in a hidden field and is re-normalised here: the
  action is a public entry point in its own right, not just the page's button.
*/

async function decide(formData: FormData, approve: boolean) {
  const code = normalizeConnectCode(formData.get("code")?.toString() ?? "");
  if (!code) redirect("/connect/unknown");

  const session = await auth();
  if (!session?.user?.id) redirect(`/signin?next=/connect/${code}`);

  if (approve) {
    const bound = await approveConnectCode(code, session.user.id);
    redirect(`/connect/${code}?done=${bound ? "approved" : "expired"}`);
  }

  await rejectConnectCode(code);
  redirect(`/connect/${code}?done=rejected`);
}

export async function approveDevice(formData: FormData) {
  await decide(formData, true);
}

export async function rejectDevice(formData: FormData) {
  await decide(formData, false);
}
