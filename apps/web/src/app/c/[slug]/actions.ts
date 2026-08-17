"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { db } from "@/db";
import { communities, memberships } from "@/db/schema";
import { rotateInviteCode } from "@/lib/communities";
import { communityBySlug } from "@/lib/community-queries";

/*
  Owner checks live here, never in the page. The buttons are hidden from members,
  but hiding a button is decoration; this is the check that counts.
*/
async function ownedCommunity(slug: string) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const community = await communityBySlug(slug);
  if (!community || community.ownerId !== session.user.id) return null;
  return community;
}

/** Replaces the invite code. Every link handed out before this stops working. */
export async function rotateInvite(formData: FormData) {
  const slug = formData.get("slug")?.toString() ?? "";
  const community = await ownedCommunity(slug);
  if (!community) return;

  await db
    .update(communities)
    .set({ inviteCode: rotateInviteCode(community.inviteCode) })
    .where(eq(communities.id, community.id));

  revalidatePath(`/c/${community.slug}`);
}

/*
  Removes a member. The owner row is excluded in SQL as well as in the UI, so a
  hand-made request cannot leave the Community without an owner.
*/
export async function removeMember(formData: FormData) {
  const slug = formData.get("slug")?.toString() ?? "";
  const builderId = formData.get("builderId")?.toString() ?? "";
  const community = await ownedCommunity(slug);
  if (!community || !builderId) return;

  await db
    .delete(memberships)
    .where(
      and(
        eq(memberships.communityId, community.id),
        eq(memberships.builderId, builderId),
        ne(memberships.role, "owner"),
      ),
    );

  revalidatePath(`/c/${community.slug}`);
}
