/*
  The usage section of a profile: thirty days of burn, then totals by provider
  and by model. Tables before prose, tabular numbers, one yellow.

  The owner sees a third table of Quarantined rows with the reason attached.
  Nobody else knows they exist, which keeps a held day from reading as an
  accusation in public.
*/
import { Badge } from "@/components/ui/badge";
import { CostSparkline } from "@/components/usage/cost-sparkline";
import type { UsageGroup, UsageSummary } from "@/lib/usage";
import { tokensIn } from "@/lib/usage";

const money = (usd: number) =>
  usd.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const tokens = (count: number) => count.toLocaleString("en-US");

function TrustBadge({ level }: { level: "verified" | "reported" | "quarantined" }) {
  return <Badge tone={level}>{level}</Badge>;
}

function Totals({ rows, label }: { rows: readonly UsageGroup[]; label: string }) {
  if (rows.length === 0) return null;

  return (
    <div>
      <h3 className="type-label text-subtle">{label}</h3>
      <table className="mt-3 w-full border-collapse text-[0.85rem]">
        <thead>
          <tr className="type-label text-subtle">
            <th className="py-1 text-left font-normal">{label === "by model" ? "model" : "agent"}</th>
            <th className="py-1 text-right font-normal">cost</th>
            <th className="py-1 text-right font-normal">tokens</th>
            <th className="py-1 text-right font-normal">trust</th>
          </tr>
        </thead>
        <tbody className="type-data">
          {rows.map((row) => (
            <tr key={`${row.provider} ${row.model}`} className="border-t border-border-faint">
              <td className="py-1.5 pr-3">
                {row.model || row.provider}
                {row.model ? <span className="ml-2 text-subtle">{row.provider}</span> : null}
              </td>
              <td className="py-1.5 text-right tabular-nums">{money(row.costUsd)}</td>
              <td className="py-1.5 pl-3 text-right tabular-nums text-muted">{tokens(row.tokens)}</td>
              <td className="py-1.5 pl-3 text-right">
                <TrustBadge level={row.trustLevel} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function UsagePanel({
  summary,
  windowDays,
  isOwner,
}: {
  summary: UsageSummary;
  windowDays: number;
  isOwner: boolean;
}) {
  const hasUsage = summary.byProvider.length > 0;

  return (
    <section className="rounded-(--radius-panel) border border-border bg-surface p-6 sm:p-8">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h2 className="type-label">usage</h2>
        <span className="type-label text-subtle">last {windowDays} days</span>
        <div className="ml-auto text-right">
          <p className="type-data text-[1.6rem] leading-none text-primary tabular-nums">
            {money(summary.totalCostUsd)}
          </p>
          <p className="type-label mt-1 text-subtle">{tokens(summary.totalTokens)} tokens</p>
        </div>
      </div>

      {hasUsage ? (
        <>
          <div className="mt-6">
            <CostSparkline points={summary.days} />
          </div>

          <div className="mt-8 grid gap-8 sm:grid-cols-2">
            <Totals rows={summary.byProvider} label="by agent" />
            <Totals rows={summary.byModel} label="by model" />
          </div>

          <p className="mt-8 max-w-[52ch] text-[0.85rem] text-subtle">
            Verified means signed by a device and plausible. Not proof. Reported means the agent
            gives us no message identifiers to check against.
          </p>
        </>
      ) : (
        <p className="mt-4 max-w-[46ch] text-[0.95rem] text-muted">
          Nothing synced yet. Usage appears once a machine is connected and the collector uploads a
          first day.
        </p>
      )}

      {isOwner && summary.quarantined.length > 0 ? (
        <div className="mt-8 border-t border-border pt-6">
          <div className="flex items-center gap-2">
            <h3 className="type-label text-subtle">quarantined</h3>
            <Badge tone="quarantined">only you see this</Badge>
          </div>
          <table className="mt-3 w-full border-collapse text-[0.85rem]">
            <tbody className="type-data">
              {summary.quarantined.map((row) => (
                <tr key={`${row.day} ${row.provider} ${row.model}`} className="border-t border-border-faint">
                  <td className="py-1.5 pr-3">{row.day}</td>
                  <td className="py-1.5 pr-3 text-muted">{row.model}</td>
                  <td className="py-1.5 text-right tabular-nums">{money(row.costUsd)}</td>
                  <td className="py-1.5 pl-3 text-right tabular-nums text-subtle">
                    {tokens(tokensIn(row))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 max-w-[52ch] text-[0.85rem] text-subtle">
            These days failed a plausibility check, so they stay out of leaderboards and credits
            until someone reviews them.
          </p>
        </div>
      ) : null}
    </section>
  );
}
