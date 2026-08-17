import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { NewCommunityForm } from "./new-community-form";

export const metadata: Metadata = {
  title: "New community",
  description: "Create a community with its own leaderboards and markets.",
  robots: { index: false, follow: false },
};

export default async function NewCommunityPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin?next=/communities/new");

  return (
    <section className="mx-auto grid max-w-[1200px] gap-10 px-4 pb-24 pt-14 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16 lg:px-12">
      <div>
        <p className="type-label">new community</p>
        <h1 className="type-heading mt-3">Start a group.</h1>
        <p className="mt-3 max-w-[46ch] text-[0.95rem] text-muted">
          You own it. People join with the invite link, and you can rotate that link or remove
          someone at any time.
        </p>
        <NewCommunityForm />
      </div>

      <aside className="rounded-(--radius-panel) border border-border bg-surface p-6 sm:p-8 lg:mt-16">
        <h2 className="type-label">what you get</h2>
        <ul className="mt-4 space-y-3 text-[0.95rem] text-muted">
          <li>A page at /c/your-slug with the member list and their trust badges.</li>
          <li>An invite link that only members can see.</li>
          <li>Community leaderboards and markets as those ship.</li>
        </ul>
      </aside>
    </section>
  );
}
