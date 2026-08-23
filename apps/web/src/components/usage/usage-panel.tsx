/*
  The usage section of a profile: thirty days of burn, then totals by provider
  and by model. Tables before prose, tabular numbers, one yellow.

  The owner sees a third table of Quarantined rows with the reason attached.
  Nobody else knows they exist, which keeps a held day from reading as an
  accusation in public.
*/
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { CostSparkline } from "@/components/usage/cost-sparkline";
import {
  USAGE_WINDOW_DAYS,
  type UsageGroup,
  type UsageHistory,
  type UsageSummary,
  type UsageWindowDays,
} from "@/lib/usage";
import { tokensIn } from "@/lib/usage";

const money = (usd: number) =>
  usd.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const tokens = (count: number) => count.toLocaleString("en-US");

const monthFormat = new Intl.DateTimeFormat("en", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const dayFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

function UsageHistorySection({ history }: { history: UsageHistory }) {
  if (history.firstDay === null) return null;

  const visibleMonths = history.months.slice(-12);
  const peak = Math.max(...visibleMonths.map((month) => month.costUsd), 0);

  return (
    <div className="mt-8 border-t border-border pt-8">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h3 className="type-label">history</h3>
        <span className="type-label text-subtle">
          since {dayFormat.format(new Date(`${history.firstDay}T00:00:00Z`))}
        </span>
      </div>

      <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-5 min-[360px]:grid-cols-2 sm:grid-cols-3">
        <div>
          <dt className="type-label text-subtle">all-time cost</dt>
          <dd className="type-data mt-1 text-[1.1rem] text-primary tabular-nums">
            {money(history.totalCostUsd)}
          </dd>
        </div>
        <div>
          <dt className="type-label text-subtle">all-time tokens</dt>
          <dd className="type-data mt-1 text-[1.1rem] tabular-nums">
            {tokens(history.totalTokens)}
          </dd>
        </div>
        <div>
          <dt className="type-label text-subtle">active days</dt>
          <dd className="type-data mt-1 text-[1.1rem] tabular-nums">{tokens(history.activeDays)}</dd>
        </div>
      </dl>

      <div className="mt-7">
        <p className="type-label text-subtle">monthly cost</p>
        <ol className="mt-3 space-y-2" aria-label="Monthly usage cost">
          {visibleMonths.map((month) => (
            <li
              key={month.month}
              className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-3 text-[0.8rem]"
            >
              <span className="type-data text-subtle">
                {monthFormat.format(new Date(`${month.month}-01T00:00:00Z`))}
              </span>
              <span className="h-1.5 bg-surface-sunken" aria-hidden>
                <span
                  className="block h-full bg-primary"
                  style={{ width: `${peak === 0 ? 0 : Math.max(2, (month.costUsd / peak) * 100)}%` }}
                />
              </span>
              <span className="type-data min-w-16 text-right tabular-nums">
                {money(month.costUsd)}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function TrustBadge({ level }: { level: "verified" | "reported" | "quarantined" }) {
  return <Badge tone={level}>{level}</Badge>;
}

function UsagePeriodSwitch({
  active,
  profilePath,
}: {
  active: UsageWindowDays;
  profilePath: string;
}) {
  return (
    <nav aria-label="Usage period" className="flex rounded-(--radius-control) border border-border">
      {USAGE_WINDOW_DAYS.map((days) => {
        const selected = days === active;
        return (
          <Link
            key={days}
            href={days === 30 ? profilePath : `${profilePath}?days=${days}`}
            aria-current={selected ? "page" : undefined}
            className={`type-label flex h-10 items-center px-3 text-[0.62rem] transition-colors first:rounded-l-(--radius-control) last:rounded-r-(--radius-control) ${
              selected ? "bg-surface-raised text-primary-text" : "text-muted hover:text-foreground"
            }`}
          >
            {days} days
          </Link>
        );
      })}
    </nav>
  );
}

function Totals({ rows, label }: { rows: readonly UsageGroup[]; label: string }) {
  if (rows.length === 0) return null;

  return (
    <div className="min-w-0">
      <h3 className="type-label text-subtle">{label}</h3>
      <ul className="mt-3 space-y-3 sm:hidden">
        {rows.map((row) => (
          <li key={`${row.provider} ${row.model}`} className="border-t border-border-faint pt-3">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <span className="min-w-0 break-words text-[0.9rem]">
                {row.model || row.provider}
                {row.model ? <span className="ml-2 text-subtle">{row.provider}</span> : null}
              </span>
              <TrustBadge level={row.trustLevel} />
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-4">
              <div>
                <dt className="type-label text-[0.58rem] text-subtle">cost</dt>
                <dd className="type-data mt-1 whitespace-nowrap text-[0.78rem] tabular-nums min-[360px]:text-[0.85rem]">
                  {money(row.costUsd)}
                </dd>
              </div>
              <div className="text-right">
                <dt className="type-label text-[0.58rem] text-subtle">tokens</dt>
                <dd className="type-data mt-1 whitespace-nowrap text-[0.72rem] text-muted tabular-nums min-[360px]:text-[0.8rem]">
                  {tokens(row.tokens)}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
      <table className="mt-3 hidden w-full table-fixed border-collapse text-[0.85rem] sm:table">
        <colgroup>
          <col className="w-[34%]" />
          <col className="w-[19%]" />
          <col className="w-[29%]" />
          <col className="w-[18%]" />
        </colgroup>
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
              <td className="break-words py-1.5 pr-3">
                {row.model || row.provider}
                {row.model ? <span className="ml-2 text-subtle">{row.provider}</span> : null}
              </td>
              <td className="py-1.5 text-right tabular-nums">{money(row.costUsd)}</td>
              <td className="whitespace-nowrap py-1.5 pl-3 text-right text-[0.78rem] tabular-nums text-muted">
                {tokens(row.tokens)}
              </td>
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
  history,
  windowDays,
  isOwner,
  profilePath,
}: {
  summary: UsageSummary;
  history: UsageHistory;
  windowDays: UsageWindowDays;
  isOwner: boolean;
  profilePath: string;
}) {
  const hasUsage = summary.byProvider.length > 0;

  return (
    <section className="min-w-0 rounded-(--radius-panel) border border-border bg-surface p-6 sm:p-8">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h2 className="type-label">usage</h2>
        <UsagePeriodSwitch active={windowDays} profilePath={profilePath} />
        <div className="ml-auto min-w-0 text-right">
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

          <div className="mt-8 grid min-w-0 gap-8">
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
          {history.firstDay
            ? `No detailed usage in the last ${windowDays} days.`
            : "Nothing synced yet. Usage appears once a machine is connected and the collector uploads a first day."}
        </p>
      )}

      {isOwner && summary.quarantined.length > 0 ? (
        <div className="mt-8 border-t border-border pt-6">
          <div className="flex items-center gap-2">
            <h3 className="type-label text-subtle">quarantined</h3>
            <Badge tone="quarantined">only you see this</Badge>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[28rem] border-collapse text-[0.85rem]">
              <tbody className="type-data">
                {summary.quarantined.map((row) => (
                  <tr
                    key={`${row.day} ${row.provider} ${row.model}`}
                    className="border-t border-border-faint"
                  >
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
          </div>
          <p className="mt-3 max-w-[52ch] text-[0.85rem] text-subtle">
            These days failed a plausibility check, so they stay out of leaderboards and credits
            until someone reviews them.
          </p>
        </div>
      ) : null}

      <UsageHistorySection history={history} />
    </section>
  );
}
