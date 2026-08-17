import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import { publicCommunities } from "@/lib/community-queries";

export const metadata: Metadata = {
  title: "Communities",
  description:
    "Public communities on tokenburnmarket. Each one has its own leaderboards and markets.",
  alternates: { canonical: "/communities" },
};

export default async function CommunitiesPage() {
  const [session, directory] = await Promise.all([auth(), publicCommunities()]);
  const signedIn = Boolean(session?.user?.id);

  return (
    <section className="mx-auto max-w-[1200px] px-4 pb-24 pt-14 sm:px-6 lg:px-12">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="type-label">communities</p>
          <h1 className="type-heading mt-3">Groups that burn together.</h1>
          <p className="mt-3 max-w-[52ch] text-[0.95rem] text-muted">
            A community has its own leaderboards and markets. Public ones are listed here. Unlisted
            ones exist only for the people holding the invite link.
          </p>
        </div>
        {signedIn ? (
          <Button as={Link} href="/communities/new">
            New community
          </Button>
        ) : (
          <Button as={Link} href="/signin?next=/communities/new" variant="secondary">
            Sign in to create one
          </Button>
        )}
      </div>

      <div className="signal-rail my-10" aria-hidden />

      {directory.length === 0 ? (
        <p className="text-[0.95rem] text-muted">
          No public communities yet. The first one is yours to make.
        </p>
      ) : (
        <ul className="rounded-(--radius-panel) border border-border bg-surface">
          {directory.map((community, index) => (
            <li
              key={community.slug}
              className={index === 0 ? "" : "border-t border-border-faint"}
            >
              <Link
                href={`/c/${community.slug}`}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-4 hover:bg-surface-raised sm:px-6"
              >
                <span className="text-[0.98rem] font-medium text-foreground">{community.name}</span>
                <span className="type-data text-[0.8rem] text-subtle">/c/{community.slug}</span>
                {community.bio ? (
                  <span className="w-full text-[0.88rem] text-muted sm:w-auto sm:flex-1 sm:truncate">
                    {community.bio}
                  </span>
                ) : (
                  <span className="sm:flex-1" />
                )}
                <span className="type-data text-[0.82rem] text-muted tabular-nums">
                  {community.members} {community.members === 1 ? "member" : "members"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
