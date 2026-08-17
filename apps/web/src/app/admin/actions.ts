"use server";

/*
  Deciding one Quarantined Usage row. The admin check lives here as well as on
  the page: hiding the page is decoration, this is the check that counts.
*/

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { applyReview, isReviewDecision, normalizeNote } from "@/lib/admin-review";
import { drizzleAdminReviewStore } from "@/lib/admin-review-store";

export async function reviewQuarantinedUsage(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id || !isAdmin(session.user.handle)) return;

  const decision = formData.get("decision")?.toString() ?? "";
  if (!isReviewDecision(decision)) return;

  const key = {
    deviceId: formData.get("deviceId")?.toString() ?? "",
    day: formData.get("day")?.toString() ?? "",
    provider: formData.get("provider")?.toString() ?? "",
    model: formData.get("model")?.toString() ?? "",
  };
  if (Object.values(key).some((value) => value === "")) return;

  await applyReview(drizzleAdminReviewStore, {
    key,
    decision,
    note: normalizeNote(formData.get("note")?.toString()),
    reviewerId: session.user.id,
  });

  // A cleared row changes a Builder-day, which every board and profile reads.
  revalidatePath("/admin");
  revalidatePath("/leaderboard");
}
