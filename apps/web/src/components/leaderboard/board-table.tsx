/*
  The one Leaderboard table. Every board renders through it: the landing
  preview, /leaderboard, a region page, a Community board.

  It holds no state and imports nothing server-only, so it works inside the
  client tab strip on the landing page as well as in a server page.
*/
import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { METRIC_LABELS, type BoardRow, type Metric } from "@/lib/leaderboard";

const money = (usd: number) =>
  usd.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/* Token counts run to billions; a rank column reads better at three significant digits. */
const tokens = (count: number) =>
  count.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** Credits won carry their sign, because the direction is the point. Zero is just zero. */
const credits = (amount: number) => {
  const rounded = Math.round(amount);
  const size = Math.abs(rounded).toLocaleString("en-US");
  return rounded === 0 ? "0" : `${rounded < 0 ? "-" : "+"}${size}`;
};

export function formatMetric(value: number, metric: Metric): string {
  if (metric === "cost") return money(value);
  if (metric === "tokens") return tokens(value);
  return credits(value);
}

/** Places gained, always with a word or a sign, never colour alone. */
function rankChangeLabel(change: number | null): string {
  if (change === null) return "new";
  if (change === 0) return "same";
  return `${change > 0 ? "+" : "-"}${Math.abs(change)}`;
}

export interface BoardTableProps {
  rows: readonly BoardRow[];
  metric: Metric;
  /** Left side of the header strip, such as "Europe" or a Community name. */
  label: string;
  /** Right side of the header strip, usually the Season and the total. */
  caption?: string;
  /** Shown when nobody burned in this scope. */
  empty?: string;
  /** Off on all-time, which has no previous Season to compare against. */
  showRankChange?: boolean;
  id?: string;
}

export function BoardTable({
  rows,
  metric,
  label,
  caption,
  empty = "No burn here yet.",
  showRankChange = true,
  id,
}: BoardTableProps) {
  return (
    <div id={id} className="rounded-(--radius-panel) border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-border-faint px-5 py-3">
        <span className="type-label text-[0.66rem]">{label}</span>
        {caption ? (
          <span className="type-data ml-auto text-[0.72rem] text-subtle">{caption}</span>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-8 text-[0.95rem] text-muted">{empty}</p>
      ) : (
        <ol>
          {rows.map((row) => (
            <li
              key={row.builderId}
              className="grid grid-cols-[2rem_1fr_auto] items-center gap-x-4 border-b border-border-faint px-5 py-2.5 last:border-b-0 sm:grid-cols-[2rem_1fr_7rem_4rem]"
            >
              <span className="type-data text-[0.8rem] text-subtle tabular-nums">
                {String(row.rank).padStart(2, "0")}
              </span>
              <span className="flex min-w-0 items-center gap-2 text-[0.95rem]">
                {row.avatarUrl ? (
                  <Image
                    src={row.avatarUrl}
                    alt=""
                    width={22}
                    height={22}
                    className="shrink-0 rounded-full border border-border"
                    unoptimized
                  />
                ) : (
                  <span className="h-[22px] w-[22px] shrink-0 rounded-full border border-border bg-surface-sunken" />
                )}
                <Link href={`/@${row.handle}`} className="truncate hover:text-primary-text">
                  {row.handle}
                </Link>
                {row.reported ? <Badge tone="reported">reported</Badge> : null}
              </span>
              <span className="type-data text-right text-[0.95rem] tabular-nums">
                {formatMetric(row.value, metric)}
              </span>
              {showRankChange ? (
                <span className="type-data hidden text-right text-[0.72rem] text-subtle tabular-nums sm:block">
                  {rankChangeLabel(row.rankChange)}
                </span>
              ) : (
                <span className="hidden sm:block" />
              )}
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-4 px-5 py-3">
        <span className="type-label text-[0.66rem] text-subtle">
          {METRIC_LABELS[metric]}
          {showRankChange ? " · places gained" : null}
        </span>
      </div>
    </div>
  );
}
