import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { communities, memberships } from "@/db/schema";
import { isInviteCode } from "@/lib/communities";

/*
  Follow an invite: sign in if needed, join, land on the community page.

  The join happens here rather than behind a button because the link is the intent.
  Invite links are pasted, not linked from this site, so nothing prefetches them,
  and a code that has been rotated simply no longer matches any community.
*/

export const metadata: Metadata = {
  title: "Invite",
  description: "Follow an invite to a community.",
  robots: { index: false, follow: false },
};

export default async function JoinPage({ params }: PageProps<"/join/[code]">) {
  const { code } = await params;

  const session = await auth();
  if (!session?.user?.id) redirect(`/signin?next=/join/${encodeURIComponent(code)}`);

  const [community] = isInviteCode(code)
    ? await db.select().from(communities).where(eq(communities.inviteCode, code)).limit(1)
    : [];

  if (!community) {
    return (
      <section className="mx-auto max-w-[1200px] px-4 pb-24 pt-14 sm:px-6 lg:px-12">
        <p className="type-label">invite</p>
        <h1 className="type-heading mt-3">This link no longer works.</h1>
        <p className="mt-4 max-w-[46ch] text-[0.95rem] text-muted">
          The code was rotated or the community is gone. Ask a member for a fresh link.
        </p>
        <Button as={Link} href="/communities" variant="secondary" className="mt-7">
          Browse communities
        </Button>
      </section>
    );
  }

  // Membership is keyed on the pair, so following the same link twice is a no-op.
  await db
    .insert(memberships)
    .values({ communityId: community.id, builderId: session.user.id, role: "member" })
    .onConflictDoNothing();

  redirect(`/c/${community.slug}`);
}
