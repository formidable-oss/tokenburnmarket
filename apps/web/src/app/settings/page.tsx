import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentBuilder } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CreditsPanel } from "@/components/credits/credits-panel";
import { AgentSetup } from "@/components/setup/agent-setup";
import { recentCreditEntries } from "@/lib/credit-queries";
import { activeDevicesFor } from "@/lib/device-auth";
import { agentSetupPrompt } from "@/lib/setup-prompt";
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

  const [devices, creditEntries] = await Promise.all([
    activeDevicesFor(builder.id),
    recentCreditEntries(builder.id),
  ]);

  return (
    <section className="mx-auto max-w-[1200px] px-4 pb-24 pt-14 sm:px-6 lg:px-12">
      <p className="type-label">settings</p>
      <h1 className="type-heading mt-3">@{builder.handle}</h1>
      <p className="mt-3 max-w-[46ch] text-[0.95rem] text-muted">
        GitHub owns your handle and avatar. Set your country and X handle here.
      </p>

      {devices.length === 0 ? (
        <div className="mt-8">
          <AgentSetup prompt={agentSetupPrompt(builder.handle)} />
        </div>
      ) : null}

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

      <CreditsPanel balance={builder.creditBalance} entries={creditEntries} />

      <div className="signal-rail my-10" aria-hidden />

      <h2 className="type-label">devices</h2>
      <p className="mt-3 max-w-[52ch] text-[0.95rem] text-muted">
        Every machine that uploads usage signs it with a key you approved. Revoking one stops it on
        its next request and keeps the usage it already sent.
      </p>

      {devices.length === 0 ? (
        <p className="mt-6 text-[0.95rem] text-muted">
          No device yet. Start with the prompt above.
        </p>
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
