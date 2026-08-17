"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/db";
import { communities, memberships } from "@/db/schema";
import {
  generateInviteCode,
  normalizeBio,
  normalizeName,
  normalizeSlug,
  normalizeVisibility,
} from "@/lib/communities";

export type CreateState = {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: { name?: string; slug?: string; bio?: string };
};

/** Postgres unique violation. The slug race is the only one this form can lose. */
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: string }).code === UNIQUE_VIOLATION
    : false;
}

/*
  Creates a Community and makes the creator its owner in one batch, so a failure
  never leaves a Community nobody can administer. The id is generated here rather
  than by the database because both statements need it before either runs.
*/
export async function createCommunity(
  _previous: CreateState,
  formData: FormData,
): Promise<CreateState> {
  const session = await auth();
  if (!session?.user?.id) return { status: "error", message: "Sign in again to create." };

  const name = normalizeName(formData.get("name")?.toString());
  const slug = normalizeSlug(formData.get("slug")?.toString());
  const bio = normalizeBio(formData.get("bio")?.toString());
  const visibility = normalizeVisibility(formData.get("visibility")?.toString());

  if (!name.ok || !slug.ok || !bio.ok) {
    return {
      status: "error",
      message: "Nothing created.",
      fieldErrors: {
        name: name.ok ? undefined : name.error,
        slug: slug.ok ? undefined : slug.error,
        bio: bio.ok ? undefined : bio.error,
      },
    };
  }

  const id = crypto.randomUUID();

  try {
    await db.batch([
      db.insert(communities).values({
        id,
        slug: slug.value,
        name: name.value,
        bio: bio.value,
        visibility,
        ownerId: session.user.id,
        inviteCode: generateInviteCode(),
      }),
      db.insert(memberships).values({
        communityId: id,
        builderId: session.user.id,
        role: "owner",
      }),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        status: "error",
        message: "Nothing created.",
        fieldErrors: { slug: "That slug is taken." },
      };
    }
    throw error;
  }

  revalidatePath("/communities");
  redirect(`/c/${slug.value}`);
}
