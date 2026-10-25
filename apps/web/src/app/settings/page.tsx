import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentBuilder } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CreditsPanel } from "@/components/credits/credits-panel";
import { AgentSetup } from "@/components/setup/agent-setup";
import { recentCreditEntries } from "@/lib/credit-queries";
import { OWN_MACHINE, devicesWithUsage, machinePeer, type DeviceSummary } from "@/lib/device-queries";
import { agentSetupPrompt } from "@/lib/setup-prompt";
import { revokeDevice, setDeviceMachine, setDeviceTrading, signOutAction } from "./actions";
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

const connectedOn = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", dateStyle: "medium" });

const money = (usd: number) =>
  usd.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/** Names repeat when one machine was connected twice, so the date tells them apart. */
function deviceLabel(device: DeviceSummary): string {
  return `${device.name}, connected ${connectedOn.format(device.createdAt)}`;
}

export default async function SettingsPage() {
  const builder = await currentBuilder();
  if (!builder) redirect("/signin?next=/settings");

  const [devices, creditEntries] = await Promise.all([
    devicesWithUsage(builder.id),
    recentCreditEntries(builder.id),
  ]);
  const active = devices.filter((device) => !device.revokedAt);

  return (
    <section className="mx-auto max-w-[1200px] px-4 pb-24 pt-14 sm:px-6 lg:px-12">
      <p className="type-label">settings</p>
      <h1 className="type-heading mt-3">@{builder.handle}</h1>
      <p className="mt-3 max-w-[46ch] text-[0.95rem] text-muted">
        GitHub owns your handle and avatar. Set your country and X handle here.
      </p>

      {active.length === 0 ? (
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
        its next request and keeps the usage it already sent. Connecting it again makes a new
        device.
      </p>
      {devices.length > 1 ? (
        <p className="mt-3 max-w-[52ch] text-[0.95rem] text-muted">
          Connected one machine more than once? Set its devices to the same machine. Each day then
          counts once for that machine, from the most complete copy. Different machines always add
          up.
        </p>
      ) : null}

      {devices.length === 0 ? (
        <p className="mt-6 text-[0.95rem] text-muted">
          No device yet. Start with the prompt above.
        </p>
      ) : (
        <ul className="mt-6 rounded-(--radius-panel) border border-border bg-surface">
          {devices.map((device, index) => {
            const peer = machinePeer(device, devices);
            const others = devices.filter((other) => other.id !== device.id);
            return (
              <li
                key={device.id}
                className={`flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4 ${
                  index > 0 ? "border-t border-border-faint" : ""
                }`}
              >
                <div className="min-w-[14rem] flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="type-data text-[0.95rem] text-foreground">{device.name}</span>
                    {device.revokedAt ? <Badge tone="neutral">revoked</Badge> : null}
                    {device.lastSyncAt ? null : <Badge tone="neutral">never synced</Badge>}
                    {!device.revokedAt && device.canTrade ? <Badge tone="neutral">can place bets</Badge> : null}
                  </p>
                  <p className="type-data mt-1 text-[0.82rem] text-muted">
                    connected {connectedOn.format(device.createdAt)}
                    {device.lastSyncAt ? <> · last sync {syncedAt.format(device.lastSyncAt)} UTC</> : null}
                  </p>
                  {device.firstDay && device.lastDay ? (
                    <p className="type-data mt-1 text-[0.82rem] text-muted">
                      usage {device.firstDay} to {device.lastDay} · {money(device.countedCostUsd)} counted
                    </p>
                  ) : null}
                </div>
                {others.length > 0 ? (
                  <form action={setDeviceMachine} className="flex items-center gap-2">
                    <input type="hidden" name="deviceId" value={device.id} />
                    <label className="sr-only" htmlFor={`machine-${device.id}`}>
                      Machine for {deviceLabel(device)}
                    </label>
                    <select
                      id={`machine-${device.id}`}
                      name="machine"
                      defaultValue={peer?.id ?? OWN_MACHINE}
                      className="type-data h-10 max-w-[22rem] rounded-(--radius-control) border border-border bg-surface-sunken px-3 text-sm text-foreground"
                    >
                      <option value={OWN_MACHINE}>Its own machine</option>
                      {others.map((other) => (
                        <option key={other.id} value={other.id}>
                          Same machine as {deviceLabel(other)}
                        </option>
                      ))}
                    </select>
                    <Button type="submit" variant="secondary">
                      Save
                    </Button>
                  </form>
                ) : null}
                {device.revokedAt ? null : (
                  <form action={setDeviceTrading}>
                    <input type="hidden" name="deviceId" value={device.id} />
                    <input type="hidden" name="canTrade" value={device.canTrade ? "off" : "on"} />
                    <Button type="submit" variant="ghost">
                      {device.canTrade ? "Stop bets" : "Allow bets"}
                    </Button>
                  </form>
                )}
                {device.revokedAt ? null : (
                  <form action={revokeDevice}>
                    <input type="hidden" name="deviceId" value={device.id} />
                    <Button type="submit" variant="ghost">
                      Revoke
                    </Button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
