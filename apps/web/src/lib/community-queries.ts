/*
  Database reads for Communities. Kept out of lib/communities.ts so the pure rules
  stay testable without a database, and out of the pages so a query is written once.
*/
import { and, asc, count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { builders, communities, memberships } from "@/db/schema";

export type DirectoryEntry = {
  slug: string;
  name: string;
  bio: string | null;
  members: number;
};

/** The public directory. Unlisted Communities are never listed, only linked. */
export async function publicCommunities(): Promise<DirectoryEntry[]> {
  return db
    .select({
      slug: communities.slug,
      name: communities.name,
      bio: communities.bio,
      members: count(memberships.builderId),
    })
    .from(communities)
    .leftJoin(memberships, eq(memberships.communityId, communities.id))
    .where(eq(communities.visibility, "public"))
    .groupBy(communities.id)
    .orderBy(desc(count(memberships.builderId)), asc(communities.name));
}

export async function communityBySlug(slug: string) {
  const [community] = await db
    .select()
    .from(communities)
    .where(eq(communities.slug, slug.toLowerCase()))
    .limit(1);
  return community ?? null;
}

export type Member = {
  id: string;
  handle: string;
  avatarUrl: string | null;
  role: "owner" | "member";
  joinedAt: Date;
};

/** Owner first, then the order people joined: a member list is a small leaderboard. */
export async function membersOf(communityId: string): Promise<Member[]> {
  return db
    .select({
      id: builders.id,
      handle: builders.handle,
      avatarUrl: builders.avatarUrl,
      role: memberships.role,
      joinedAt: memberships.joinedAt,
    })
    .from(memberships)
    .innerJoin(builders, eq(builders.id, memberships.builderId))
    .where(eq(memberships.communityId, communityId))
    .orderBy(desc(eq(memberships.role, "owner")), asc(memberships.joinedAt));
}

/** Membership decides who sees the invite link, so it is always read server-side. */
export async function isMember(communityId: string, builderId: string): Promise<boolean> {
  const [row] = await db
    .select({ builderId: memberships.builderId })
    .from(memberships)
    .where(
      and(eq(memberships.communityId, communityId), eq(memberships.builderId, builderId)),
    )
    .limit(1);
  return Boolean(row);
}
