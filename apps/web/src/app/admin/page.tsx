import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isAdmin } from "@/lib/admin";
import { openSiteMarkets, quarantineQueue } from "@/lib/admin-queries";
import { REVIEW_NOTE_MAX } from "@/lib/admin-review";
import { countryByCode } from "@/lib/countries";
import { reviewQuarantinedUsage } from "./actions";

export const metadata: Metadata = {
  title: "Admin",
  description: "Review quarantined usage and open site markets.",
  robots: { index: false, follow: false },
};

const money = (usd: number) =>
  usd.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const tokens = (count: number) => count.toLocaleString("en-US");

/** UTC, minute precision, the same clock every other table on the site uses. */
const stamp = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  dateStyle: "medium",
  timeStyle: "short",
});

/*
  The admin desk. Two jobs and nothing else: judge the Usage that failed a check,
  and open the Markets that speak for the whole site.

  A non-admin gets 404 rather than 403, so the page does not advertise itself.
*/
export default async function AdminPage() {
  const session = await auth();
  if (!isAdmin(session?.user?.handle)) notFound();

  const [queue, siteMarkets] = await Promise.all([quarantineQueue(), openSiteMarkets()]);
  const heldRows = queue.reduce((sum, group) => sum + group.rows.length, 0);

  return (
    <section className="mx-auto max-w-[1200px] px-4 pb-24 pt-14 sm:px-6 lg:px-12">
      <p className="type-label">admin</p>
      <h1 className="type-heading mt-3">Quarantine</h1>
      <p className="mt-3 max-w-[52ch] text-[0.95rem] text-muted">
        Usage that failed a check, held out of leaderboards, credits and market resolution until
        someone looks. Approving recounts the day and mints what it is now worth. Credits already
        awarded are never taken back.
      </p>
      <p className="type-data mt-4 text-[0.82rem] text-subtle">
        {heldRows} {heldRows === 1 ? "row" : "rows"} held across {queue.length}{" "}
        {queue.length === 1 ? "builder day" : "builder days"}
      </p>

      <div className="signal-rail my-10" aria-hidden />

      {queue.length === 0 ? (
        <p className="text-[0.95rem] text-muted">Nothing is quarantined. The queue is empty.</p>
      ) : (
        <ul className="space-y-6">
          {queue.map((group) => (
            <li
              key={`${group.builderId}|${group.day}`}
              className="rounded-(--radius-panel) border border-border bg-surface"
            >
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 border-b border-border-faint px-5 py-4 sm:px-6">
                <Link href={`/@${group.handle}`} className="type-data text-[0.95rem] hover:text-primary-text">
                  {group.handle}
                </Link>
                <span className="type-data text-[0.82rem] text-muted">{group.day}</span>
                <span className="ml-auto type-data text-[0.82rem] tabular-nums text-muted">
                  {money(group.costUsd)}
                </span>
                <span className="type-data text-[0.82rem] tabular-nums text-subtle">
                  {tokens(group.tokens)} tokens
                </span>
              </div>

              <ul>
                {group.rows.map((row) => (
                  <li
                    key={`${row.deviceId}|${row.provider}|${row.model}`}
                    className="border-b border-border-faint px-5 py-5 last:border-b-0 sm:px-6"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                      <span className="type-data text-[0.9rem]">
                        {row.model || row.provider}
                        {row.model ? <span className="ml-2 text-subtle">{row.provider}</span> : null}
                      </span>
                      <span className="type-data text-[0.82rem] text-muted">{row.deviceName}</span>
                      <span className="ml-auto type-data text-[0.82rem] tabular-nums text-muted">
                        {money(row.costUsd)}
                      </span>
                      <span className="type-data text-[0.82rem] tabular-nums text-subtle">
                        {tokens(row.tokens)} tokens
                      </span>
                    </div>

                    <ul className="mt-3 space-y-1.5">
                      {row.reasons.length === 0 ? (
                        <li className="text-[0.85rem] text-subtle">No reason recorded.</li>
                      ) : (
                        row.reasons.map((reason) => (
                          <li key={reason.code} className="flex flex-wrap items-center gap-2">
                            <Badge tone="quarantined">{reason.code.replaceAll("_", " ")}</Badge>
                            <span className="text-[0.85rem] text-muted">{reason.message}</span>
                            {reason.observed !== undefined && reason.limit !== undefined ? (
                              <span className="type-data text-[0.78rem] tabular-nums text-subtle">
                                {tokens(Math.round(reason.observed))} vs {tokens(Math.round(reason.limit))}
                              </span>
                            ) : null}
                          </li>
                        ))
                      )}
                    </ul>

                    {row.lastDecision ? (
                      <p className="type-data mt-3 text-[0.78rem] text-subtle">
                        last decision {row.lastDecision}
                        {row.lastNote ? `, note: ${row.lastNote}` : ""}
                      </p>
                    ) : null}

                    <form action={reviewQuarantinedUsage} className="mt-4">
                      <input type="hidden" name="deviceId" value={row.deviceId} />
                      <input type="hidden" name="day" value={row.day} />
                      <input type="hidden" name="provider" value={row.provider} />
                      <input type="hidden" name="model" value={row.model} />
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="sr-only" htmlFor={`note-${row.deviceId}-${row.provider}-${row.model}`}>
                          Note for {group.handle} on {row.day}
                        </label>
                        <input
                          id={`note-${row.deviceId}-${row.provider}-${row.model}`}
                          name="note"
                          type="text"
                          maxLength={REVIEW_NOTE_MAX}
                          placeholder="Note, optional"
                          className="h-10 min-w-[14rem] flex-1 rounded-(--radius-control) border border-border-strong bg-surface-sunken px-3 text-[0.85rem] text-foreground placeholder:text-subtle"
                        />
                        <Button type="submit" name="decision" value="verified">
                          Approve as verified
                        </Button>
                        <Button type="submit" name="decision" value="reported" variant="secondary">
                          Approve as reported
                        </Button>
                        <Button type="submit" name="decision" value="keep" variant="ghost">
                          Keep quarantined
                        </Button>
                      </div>
                    </form>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <div className="signal-rail my-10" aria-hidden />

      <h2 className="type-heading">Global markets</h2>
      <p className="mt-3 max-w-[52ch] text-[0.95rem] text-muted">
        Global and country markets have no community behind them, so admins open them. Trading stops
        at the close; usage is read at the resolve time, a day later, so a late sync still counts.
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        {/* The model race is the one template with a global scope, and it opens on the world. */}
        <Button as={Link} href="/markets/new?template=model_race" variant="secondary">
          Open a global market
        </Button>
        <Button as={Link} href="/markets" variant="ghost">
          All markets
        </Button>
      </div>

      {siteMarkets.length === 0 ? (
        <p className="mt-6 text-[0.95rem] text-muted">No global or country market is open.</p>
      ) : (
        <table className="mt-6 w-full border-collapse text-[0.85rem]">
          <thead>
            <tr className="type-label text-subtle">
              <th className="py-2 text-left font-normal">question</th>
              <th className="py-2 text-left font-normal">where</th>
              <th className="py-2 text-right font-normal">closes</th>
              <th className="py-2 text-right font-normal">resolves</th>
            </tr>
          </thead>
          <tbody className="type-data">
            {siteMarkets.map((market) => (
              <tr key={market.id} className="border-t border-border-faint">
                <td className="py-2 pr-4">
                  <Link href={`/m/${market.id}`} className="hover:text-primary-text">
                    {market.question}
                  </Link>
                </td>
                <td className="py-2 pr-4 text-muted">
                  {market.scope === "global"
                    ? "world"
                    : (countryByCode(market.country ?? "")?.name ?? market.country)}
                </td>
                <td className="py-2 pl-3 text-right tabular-nums text-muted">
                  {stamp.format(market.closesAt)} UTC
                </td>
                <td className="py-2 pl-3 text-right tabular-nums text-muted">
                  {stamp.format(market.resolvesAt)} UTC
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
