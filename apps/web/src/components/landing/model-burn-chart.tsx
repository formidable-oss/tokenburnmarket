"use client";

/*
  Usage per model over the current Season, as a running total in stepped lines.
  A day's Usage is one number, so each day is one flat step and the riser is
  the burn of that day. A slope between two days would be a claim nobody made,
  which is the same reason the price chart is stepped.

  The leader is yellow, with the ember at its tip. The other lines are gray.
  Each line ends in a label with its total and its model, so the labels are
  the ranking and the chart needs no legend.

  Pointing at a day moves the labels to the totals up to that day. One tab
  stop plus the arrow keys does the same for a keyboard.
*/
import Link from "next/link";
import { useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { ModelBurnChartData } from "@/lib/landing";

/* The plot is h-64. The label layout below works in the same pixels. */
const PLOT_PX = 256;
const LABEL_PX = 34;
const LABEL_GAP_PX = 38;
const LABEL_OVERHANG_PX = 10;

/* The plot and the day axis below it share these columns: the plot, then the labels. */
const COLUMNS = "grid grid-cols-[minmax(0,1fr)_7.25rem] min-[480px]:grid-cols-[minmax(0,1fr)_8.75rem]";

/* Gray lines fade a little with each place, so a crossing stays readable. */
const TRAIL_OPACITY = [1, 0.8, 0.62, 0.5];

const WIPE_STEP_MS = 45;
const WIPE_MAX_MS = 900;
const WIPE_DELAY_MS = 260;

const shortDay = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const formatDay = (day: string) => shortDay.format(new Date(`${day}T00:00:00Z`));

/** Label tops in pixels: each label centered on its line end, then pushed apart. */
function labelTops(ends: readonly number[]): number[] {
  const tops = ends.map((y) => y - LABEL_PX / 2);
  for (let i = 0; i < tops.length; i++) {
    const floor = i === 0 ? -LABEL_OVERHANG_PX : tops[i - 1]! + LABEL_GAP_PX;
    tops[i] = Math.max(tops[i]!, floor);
  }
  for (let i = tops.length - 1; i >= 0; i--) {
    const ceiling =
      i === tops.length - 1 ? PLOT_PX - LABEL_PX + LABEL_OVERHANG_PX : tops[i + 1]! - LABEL_GAP_PX;
    tops[i] = Math.min(tops[i]!, ceiling);
  }
  return tops;
}

export function ModelBurnChart({ data }: { data: ModelBurnChartData }) {
  const [selected, setSelected] = useState<number | null>(null);

  const count = data.days.length;
  const active = selected ?? count - 1;
  const leader = data.lines[0];
  const y = (value: number) => (data.top > 0 ? (1 - value / data.top) * 100 : 100);

  function selectFromPointer(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const relativeX = Math.min(Math.max(event.clientX - bounds.left, 0), bounds.width - 1);
    setSelected(Math.floor((relativeX / bounds.width) * count));
  }

  function selectFromKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    let next = active;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = Math.max(0, active - 1);
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") next = Math.min(count - 1, active + 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    else return;

    event.preventDefault();
    setSelected(next);
  }

  const tops = labelTops(data.lines.map((line) => (y(line.cumulative[count - 1]!) / 100) * PLOT_PX));
  const wipeMs = Math.min(WIPE_MAX_MS, count * WIPE_STEP_MS);
  const wipe = {
    animationDuration: `${wipeMs}ms`,
    animationDelay: `${WIPE_DELAY_MS}ms`,
    animationTimingFunction: `steps(${Math.max(1, count)})`,
  };
  /* The markers and labels arrive when the wipe reaches the right edge. */
  const afterWipe = { "--i": Math.ceil((WIPE_DELAY_MS + wipeMs) / 70) } as React.CSSProperties;

  return (
    <section aria-labelledby="model-burn-chart">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="model-burn-chart" className="type-heading">
          Models burning {data.season}.
        </h2>
        <p className="type-data flex items-center gap-2 text-[0.8rem] text-muted">
          {data.live ? (
            <>
              <span aria-hidden className="ember-pulse size-1.5 rounded-full bg-ember" />
              <span>live</span>
            </>
          ) : null}
          <span className="text-foreground">{data.total}</span>
        </p>
      </div>

      <div className="relative mt-6 p-4 sm:p-5">
        {/* Two open corners, never a full box: the same frame as the mark. */}
        <span aria-hidden className="absolute left-0 top-0 size-6 border-l-2 border-t-2 border-foreground/50" />
        <span aria-hidden className="absolute bottom-0 right-0 size-6 border-b-2 border-r-2 border-foreground/50" />

        {leader ? (
          <>
            <div className={COLUMNS}>
              <div
                className="relative h-64 cursor-crosshair touch-pan-y border-b border-border outline-offset-4"
                role="img"
                tabIndex={0}
                aria-label={`Running total of tokens per model, ${data.season}. ${leader.label} leads with ${leader.values[count - 1]}. Focus the chart and use the arrow keys to read each day.`}
                onFocus={() => setSelected((current) => current ?? count - 1)}
                onBlur={() => setSelected(null)}
                onKeyDown={selectFromKeyboard}
                onPointerDown={selectFromPointer}
                onPointerMove={selectFromPointer}
                onPointerLeave={(event) => {
                  if (event.pointerType === "mouse") setSelected(null);
                }}
              >
                {data.ticks.map((tick) => (
                  <div
                    key={tick.value}
                    aria-hidden
                    className="absolute inset-x-0 border-t border-border-faint"
                    style={{ top: `${y(tick.value)}%` }}
                  >
                    <span className="type-data absolute left-0 top-1 text-[0.7rem] text-subtle">
                      {tick.label}
                    </span>
                  </div>
                ))}

                {selected !== null ? (
                  <div
                    aria-hidden
                    className="absolute inset-y-0 border-x border-border-faint bg-primary-subtle"
                    style={{ left: `${(selected / count) * 100}%`, width: `${100 / count}%` }}
                  />
                ) : null}

                <div aria-hidden className="tape-wipe absolute inset-0" style={wipe}>
                  <svg
                    viewBox={`0 0 ${count} 100`}
                    preserveAspectRatio="none"
                    shapeRendering="crispEdges"
                    className="block size-full overflow-visible"
                    style={wipe}
                  >
                    {/* Last place first, so the leader is drawn on top. */}
                    {data.lines
                      .map((line, place) => {
                        const steps = line.cumulative
                          .map((value, day) => `${day === 0 ? "M0" : "V"} ${y(value).toFixed(3)} H${day + 1}`)
                          .join(" ");
                        return (
                          <path
                            key={line.label}
                            d={steps}
                            fill="none"
                            vectorEffect="non-scaling-stroke"
                            strokeWidth={place === 0 ? 2 : 1.5}
                            style={{ stroke: place === 0 ? "var(--primary)" : "var(--muted-foreground)" }}
                            strokeOpacity={place === 0 ? 1 : (TRAIL_OPACITY[place - 1] ?? 0.5)}
                          />
                        );
                      })
                      .reverse()}
                  </svg>
                </div>

                {data.lines.map((line, place) => (
                  <span
                    key={line.label}
                    aria-hidden
                    className="rise absolute z-10 size-0"
                    style={{
                      ...afterWipe,
                      left: `${((active + 1) / count) * 100}%`,
                      top: `${y(line.cumulative[active]!)}%`,
                    }}
                  >
                    <span
                      className={`absolute -left-1 -top-1 block size-2 ${
                        place === 0 ? "ember-pulse bg-ember" : "bg-muted"
                      }`}
                    />
                  </span>
                ))}
              </div>

              <ol className="relative h-64">
                {data.lines.map((line, place) => (
                  <li
                    key={line.label}
                    className="rise absolute inset-x-0 pl-3 min-[480px]:pl-3.5"
                    style={{ ...afterWipe, top: tops[place] }}
                  >
                    <span className="type-data block text-[0.88rem] leading-tight">{line.values[active]}</span>
                    <span className="block truncate text-[0.72rem] leading-tight text-muted" title={line.label}>
                      {line.label}
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            <div className={`type-data mt-2 text-[0.7rem] text-subtle ${COLUMNS}`}>
              <div className="flex justify-between gap-3">
                <span>{formatDay(data.days[0]!)}</span>
                <span className={selected === null ? "" : "text-foreground"}>
                  {selected === null ? "today" : `through ${formatDay(data.days[selected]!)}`}
                </span>
              </div>
            </div>

            <span aria-live="polite" className="sr-only">
              {selected === null
                ? ""
                : `Through ${formatDay(data.days[selected]!)}: ${data.lines
                    .map((line) => `${line.label} ${line.values[selected]}`)
                    .join(", ")}.`}
            </span>
          </>
        ) : (
          <p className="flex h-64 items-center text-[0.95rem] text-muted">No synced model usage yet.</p>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <p className="text-[0.8rem] text-subtle">Running totals by day. Quarantined days are left out.</p>
        <Link href="/markets" className="text-sm text-primary-text hover:underline">
          Model markets
        </Link>
      </div>
    </section>
  );
}
