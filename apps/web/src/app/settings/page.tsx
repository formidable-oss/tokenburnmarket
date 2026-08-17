import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentBuilder } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CommandLine } from "@/components/ui/command-line";
import { activeDevicesFor } from "@/lib/device-auth";
import { revokeDevice, signOutAction } from "./actions";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = {
  title: "Settings",
  description: "Set your country and X handle, or sign out.",
  robots: { index: false, follow: false },
};

/** UTC, minute precision. Devices sync from every timezone; one clock keeps rows comparable. */
const syncedAt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function SettingsPage() {
  const builder = await currentBuilder();
  if (!builder) redirect("/signin?next=/settings");

  const devices = await activeDevicesFor(builder.id);

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
            .
          </p>
          <form action={signOutAction} className="mt-6">
            <Button type="submit" variant="secondary">
              Sign out
            </Button>
          </form>
        </div>
      </div>

      <div className="signal-rail my-10" aria-hidden />

      <h2 className="type-label">devices</h2>
      <p className="mt-3 max-w-[52ch] text-[0.95rem] text-muted">
        Every machine that uploads usage signs it with a key you approved. Revoking one stops it on
        its next request and keeps the usage it already sent.
      </p>

      {devices.length === 0 ? (
        <div className="mt-6 max-w-[34rem]">
          <p className="text-[0.95rem] text-muted">
            No devices yet. Run this on the machine you code from, then approve the code here.
          </p>
          <div className="mt-4">
            <CommandLine command="npx tokenburnmarket connect" />
          </div>
        </div>
      ) : (
        <ul className="mt-6 rounded-(--radius-panel) border border-border bg-surface">
          {devices.map((device, index) => (
            <li
              key={device.id}
              className={`flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4 ${
                index > 0 ? "border-t border-border-faint" : ""
              }`}
            >
              <span className="type-data min-w-[12rem] flex-1 text-[0.95rem] text-foreground">
                {device.name}
              </span>
              <span className="type-data text-[0.82rem] text-muted">
                {device.lastSyncAt ? (
                  <>last sync {syncedAt.format(device.lastSyncAt)} UTC</>
                ) : (
                  <Badge tone="neutral">never synced</Badge>
                )}
              </span>
              <form action={revokeDevice}>
                <input type="hidden" name="deviceId" value={device.id} />
                <Button type="submit" variant="ghost">
                  Revoke
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
