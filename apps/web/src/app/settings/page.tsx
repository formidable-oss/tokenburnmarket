import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentBuilder } from "@/auth";
import { Button } from "@/components/ui/button";
import { signOutAction } from "./actions";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = {
  title: "Settings",
  description: "Set your country and X handle, or sign out.",
  robots: { index: false, follow: false },
};

export default async function SettingsPage() {
  const builder = await currentBuilder();
  if (!builder) redirect("/signin?next=/settings");

  return (
    <section className="mx-auto max-w-[1200px] px-4 pb-24 pt-14 sm:px-6 lg:px-12">
      <p className="type-label">settings</p>
      <h1 className="type-heading mt-3">{builder.handle}</h1>
      <p className="mt-3 max-w-[46ch] text-[0.95rem] text-muted">
        Two things are yours to set. Your handle and avatar come from GitHub.
      </p>

      <div className="signal-rail my-10" aria-hidden />

      <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
        <SettingsForm country={builder.country} xHandle={builder.xHandle} />

        <div className="rounded-(--radius-panel) border border-border bg-surface p-6 sm:p-8">
          <h2 className="type-label">account</h2>
          <p className="mt-4 text-[0.95rem] text-muted">
            Your public profile is at{" "}
            <Link
              href={`/@${builder.handle}`}
              className="type-data underline decoration-border-strong hover:text-foreground"
            >
              /@{builder.handle}
            </Link>
            . Devices land here in a later release.
          </p>
          <form action={signOutAction} className="mt-6">
            <Button type="submit" variant="secondary">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </section>
  );
}
