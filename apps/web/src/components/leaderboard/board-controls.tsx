/*
  The Leaderboard controls: the region tab strip, and the Season and metric
  switches. All links, no client JavaScript, so a board is shareable at the URL
  it is looked at and works before hydration.

  The tab strip keeps the landing anatomy: a row of tabs over a left-growing
  primary underline on the selected one.
*/
import Link from "next/link";
import {
  METRIC_LABELS,
  METRICS,
  PERIOD_LABELS,
  PERIODS,
  type Metric,
  type Period,
} from "@/lib/leaderboard";
import type { Region } from "@/lib/regions";

export interface BoardQuery {
  period: Period;
  metric: Metric;
}

/** The query string for a board, with the defaults left out so the URL stays short. */
export function boardHref(path: string, query: BoardQuery): string {
  const params = new URLSearchParams();
  if (query.period !== "week") params.set("period", query.period);
  if (query.metric !== "cost") params.set("metric", query.metric);
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

function Tab({
  href,
  selected,
  children,
}: {
  href: string;
  selected: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={selected ? "page" : undefined}
      className={`relative -mb-px flex h-10 items-center px-3 text-sm transition-colors ${
        selected ? "text-foreground" : "text-muted hover:text-foreground"
      }`}
    >
      {children}
      <span
        aria-hidden
        className={`absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary transition-transform duration-200 ease-(--ease-out-expo) ${
          selected ? "scale-x-100" : "scale-x-0"
        }`}
      />
    </Link>
  );
}

export function RegionTabs({
  regions,
  active,
  query,
}: {
  regions: readonly Region[];
  active: string;
  query: BoardQuery;
}) {
  return (
    <nav aria-label="Region" className="flex flex-wrap gap-1 border-b border-border-faint">
      {regions.map((region) => (
        <Tab
          key={region.slug}
          href={boardHref(region.slug === "world" ? "/leaderboard" : `/leaderboard/${region.slug}`, query)}
          selected={region.slug === active}
        >
          {region.name}
        </Tab>
      ))}
    </nav>
  );
}

function Switch({
  label,
  options,
  path,
  query,
  build,
}: {
  label: string;
  options: readonly string[];
  path: string;
  query: BoardQuery;
  build: (option: string) => BoardQuery;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="type-label text-[0.62rem] text-subtle">{label}</span>
      <div className="flex items-center rounded-(--radius-control) border border-border">
        {options.map((option) => {
          const next = build(option);
          const selected = next.period === query.period && next.metric === query.metric;
          return (
            <Link
              key={option}
              href={boardHref(path, next)}
              aria-current={selected ? "true" : undefined}
              className={`type-label flex h-8 items-center px-3 text-[0.62rem] transition-colors ${
                selected ? "bg-surface-raised text-primary-text" : "text-muted hover:text-foreground"
              }`}
            >
              {option}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** Season and metric, side by side. `path` is the board's own URL. */
export function BoardSwitches({ path, query }: { path: string; query: BoardQuery }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <Switch
        label="season"
        options={PERIODS.map((period) => PERIOD_LABELS[period])}
        path={path}
        query={query}
        build={(option) => ({
          ...query,
          period: PERIODS.find((period) => PERIOD_LABELS[period] === option)!,
        })}
      />
      <Switch
        label="metric"
        options={METRICS.map((metric) => METRIC_LABELS[metric])}
        path={path}
        query={query}
        build={(option) => ({
          ...query,
          metric: METRICS.find((metric) => METRIC_LABELS[metric] === option)!,
        })}
      />
    </div>
  );
}
