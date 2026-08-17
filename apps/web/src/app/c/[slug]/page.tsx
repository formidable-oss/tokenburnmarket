import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { CommunityBoard } from "@/components/leaderboard/community-board";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CommandLine } from "@/components/ui/command-line";
import { inviteUrl } from "@/lib/communities";
import { communityBySlug, membersOf } from "@/lib/community-queries";
import { MarketList } from "@/components/markets/market-list";
import { BOARD_PREVIEW_LIMIT } from "@/lib/leaderboard-queries";
import { openMarketsForCommunity } from "@/lib/market-queries";
import { builderTrustLevel } from "@/lib/trust";
import { removeMember, rotateInvite } from "./actions";

/*
  Public Community page. Unlisted Communities render the same, minus the directory
  listing and with robots noindex: the URL is the secret, not the page.
*/

export async function generateMetadata({ params }: PageProps<"/c/[slug]">): Promise<Metadata> {
  const community = await communityBySlug((await params).slug);
  if (!community) return { title: "Not found" };

  const title = community.name;
  const description = community.bio ?? `${community.name} on tokenburnmarket.`;
  const path = `/c/${community.slug}`;

  return {
    title,
    description,
    openGraph: { type: "website", url: path, title, description },
    twitter: { card: "summary_large_image", title, description },
    alternates: community.visibility === "public" ? { canonical: path } : undefined,
    robots: community.visibility === "unlisted" ? { index: false, follow: false } : undefined,
  };
}

/** The origin of the request, so an invite copied on a preview deploy points at it. */
async function requestOrigin(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const protocol = headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

export default async function CommunityPage({ params }: PageProps<"/c/[slug]">) {
  const { slug } = await params;
  const community = await communityBySlug(slug);
  if (!community) notFound();

  const [session, members, openMarkets] = await Promise.all([
    auth(),
    membersOf(community.id),
    openMarketsForCommunity(community.id),
  ]);
  const viewerId = session?.user?.id ?? null;
  const viewerIsMember = Boolean(viewerId && members.some((m) => m.id === viewerId));
  const viewerIsOwner = viewerId === community.ownerId;
  // The invite code never reaches a non-member's HTML, so the origin is only needed here.
  const invite = viewerIsMember ? inviteUrl(await requestOrigin(), community.inviteCode) : null;

  return (
    <section className="mx-auto max-w-[1200px] px-4 pb-24 pt-14 sm:px-6 lg:px-12">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="type-label flex items-center gap-2">
            community
            {community.visibility === "unlisted" ? <Badge tone="neutral">unlisted</Badge> : null}
          </p>
          <h1 className="type-heading mt-3">{community.name}</h1>
          <p className="type-data mt-2 text-[0.8rem] text-subtle">
            /c/{community.slug} · started {dateFormat.format(community.createdAt)}
          </p>
          {community.bio ? (
            <p className="mt-4 max-w-[52ch] text-[0.95rem] text-muted">{community.bio}</p>
          ) : null}
        </div>
        <div className="text-right">
          <p className="type-label">members</p>
          <p className="type-data mt-1 text-[1.6rem] leading-none tabular-nums text-primary">
            {members.length}
          </p>
        </div>
      </header>

      <div className="signal-rail my-10" aria-hidden />

      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="type-label">board</h2>
        <Link
          href={`/c/${community.slug}/leaderboard`}
          className="text-sm text-primary-text hover:underline"
        >
          Full board
        </Link>
      </div>
      <CommunityBoard
        community={community}
        query={{ period: "week", metric: "cost" }}
        limit={BOARD_PREVIEW_LIMIT}
      />

      <div className="signal-rail my-10" aria-hidden />

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr] lg:gap-8">
        <div className="rounded-(--radius-panel) border border-border bg-surface">
          <div className="flex items-center justify-between px-5 py-4 sm:px-6">
            <h2 className="type-label">member list</h2>
            <span className="type-label text-subtle">trust</span>
          </div>
          <ul>
            {members.map((member) => {
              const trust = builderTrustLevel(member);
              return (
                <li
                  key={member.id}
                  className="flex items-center gap-3 border-t border-border-faint px-5 py-3 sm:px-6"
                >
                  {member.avatarUrl ? (
                    <Image
                      src={member.avatarUrl}
                      alt=""
                      width={28}
                      height={28}
                      className="rounded-full border border-border"
                      unoptimized
                    />
                  ) : (
                    <span className="h-7 w-7 rounded-full border border-border bg-surface-sunken" />
                  )}
                  <Link
                    href={`/@${member.handle}`}
                    className="type-data text-[0.9rem] hover:text-primary-text"
                  >
                    {member.handle}
                  </Link>
                  {member.role === "owner" ? <Badge tone="neutral">owner</Badge> : null}
                  <span className="ml-auto flex items-center gap-3">
                    <Badge tone={trust}>{trust}</Badge>
                    {viewerIsOwner && member.role !== "owner" ? (
                      <form action={removeMember}>
                        <input type="hidden" name="slug" value={community.slug} />
                        <input type="hidden" name="builderId" value={member.id} />
                        <button
                          type="submit"
                          className="type-label text-[0.62rem] text-subtle hover:text-[color:var(--destructive)]"
                        >
                          remove
                        </button>
                      </form>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="border-t border-border-faint px-5 py-4 text-[0.85rem] text-subtle sm:px-6">
            Verified means signed and plausible. Not proof.
          </p>
        </div>

        <div className="rounded-(--radius-panel) border border-border bg-surface p-6 sm:p-8">
          {invite ? (
            <>
              <h2 className="type-label">invite link</h2>
              <p className="mt-4 text-[0.95rem] text-muted">
                Anyone with this link can join. Only members can see it.
              </p>
              <div className="mt-4">
                <CommandLine command={invite} prompt={null} />
              </div>
              {viewerIsOwner ? (
                <form action={rotateInvite} className="mt-6">
                  <input type="hidden" name="slug" value={community.slug} />
                  <Button type="submit" variant="secondary">
                    Rotate invite code
                  </Button>
                  <p className="mt-3 text-[0.85rem] text-subtle">
                    Rotating makes the old link stop working. Nobody already in is removed.
                  </p>
                </form>
              ) : null}
            </>
          ) : (
            <>
              <h2 className="type-label">joining</h2>
              <p className="mt-4 text-[0.95rem] text-muted">
                This community is invite only. Ask a member for their link, then follow it while
                signed in.
              </p>
              {viewerId ? null : (
                <Button
                  as={Link}
                  href={`/signin?next=/c/${community.slug}`}
                  variant="secondary"
                  className="mt-6"
                >
                  Sign in with GitHub
                </Button>
              )}
            </>
          )}

        </div>
      </div>

      <div className="signal-rail my-10" aria-hidden />

      <section aria-labelledby="community-markets">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="type-label" id="community-markets">
            markets
          </h2>
          {viewerIsMember ? (
            <Link href="/markets/new" className="type-label text-subtle hover:text-foreground">
              open a market
            </Link>
          ) : null}
        </div>
        {openMarkets.length === 0 ? (
          <p className="mt-4 max-w-[52ch] text-[0.95rem] text-muted">
            No open markets here yet.{" "}
            {viewerIsMember ? "Open one and the group can trade it." : "Members can open one."}
          </p>
        ) : (
          <div className="mt-4">
            <MarketList markets={openMarkets} />
          </div>
        )}
      </section>
    </section>
  );
}
