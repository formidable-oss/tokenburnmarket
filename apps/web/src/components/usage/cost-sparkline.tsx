"use client";

/*
  Daily burn stays deliberately small and bar-shaped, but each slot now carries
  the useful part of the underlying day. Pointer movement selects the nearest
  bar. One keyboard stop plus arrow keys avoids making a 90-day chart add 90
  tab stops to the page.
*/
import { useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { UsageDayPoint } from "@/lib/usage";

const money = (usd: number) =>
  usd.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: usd > 0 && usd < 0.01 ? 4 : 2,
  });

const tokens = (count: number) => count.toLocaleString("en-US");

const day = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const shortDay = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function tooltipAlignment(index: number, count: number): string {
  const position = (index + 0.5) / count;
  if (position < 0.25) return "translate-x-0";
  if (position > 0.75) return "-translate-x-full";
  return "-translate-x-1/2";
}

function pointLabel(point: UsageDayPoint): string {
  return `${day.format(new Date(`${point.day}T00:00:00Z`))}: ${money(point.costUsd)}, ${tokens(point.tokens)} tokens`;
}

export function CostSparkline({ points }: { points: readonly UsageDayPoint[] }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  if (points.length === 0) return null;

  const peak = Math.max(...points.map((point) => point.costUsd));
  const busiestIndex = points.reduce(
    (best, point, index) => (point.costUsd > points[best]!.costUsd ? index : best),
    0,
  );
  const selected = selectedIndex === null ? null : points[selectedIndex];

  function selectFromPointer(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const relativeX = Math.min(Math.max(event.clientX - bounds.left, 0), bounds.width - 1);
    setSelectedIndex(Math.floor((relativeX / bounds.width) * points.length));
  }

  function selectFromKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    const current = selectedIndex ?? points.length - 1;
    let next = current;

    if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = Math.max(0, current - 1);
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      next = Math.min(points.length - 1, current + 1);
    } else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = points.length - 1;
    else return;

    event.preventDefault();
    setSelectedIndex(next);
  }

  return (
    <div>
      <div
        className="group relative h-24 cursor-crosshair touch-pan-y pt-8"
        role="img"
        tabIndex={0}
        aria-label={`Daily cost over the last ${points.length} days. Highest day ${pointLabel(points[busiestIndex]!)}. Focus the chart and use arrow keys to inspect each day.`}
        onFocus={() => setSelectedIndex((current) => current ?? points.length - 1)}
        onBlur={() => setSelectedIndex(null)}
        onKeyDown={selectFromKeyboard}
        onPointerDown={selectFromPointer}
        onPointerMove={selectFromPointer}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") setSelectedIndex(null);
        }}
      >
        {selected ? (
          <div
            aria-hidden="true"
            className={`type-data pointer-events-none absolute top-0 z-10 flex h-7 items-center gap-2 whitespace-nowrap rounded-(--radius-control) border border-primary-border bg-surface-raised px-2.5 text-[0.68rem] shadow-[0_6px_18px_rgb(0_0_0/0.22)] ${tooltipAlignment(selectedIndex!, points.length)}`}
            style={{ left: `${((selectedIndex! + 0.5) / points.length) * 100}%` }}
          >
            <span className="text-primary-text">{day.format(new Date(`${selected.day}T00:00:00Z`))}</span>
            <span>{money(selected.costUsd)}</span>
            <span className="text-muted">{tokens(selected.tokens)} tokens</span>
          </div>
        ) : null}

        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 top-8 grid items-end border-b border-border"
          style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
        >
          {points.map((point, index) => {
            // A day with usage never rounds to nothing: two pixels say "this happened".
            const height =
              peak === 0 ? 0 : Math.max(point.costUsd > 0 ? 2 : 0, (point.costUsd / peak) * 100);
            const active = index === selectedIndex;

            return (
              <span
                key={point.day}
                className={`relative h-full border-x border-transparent transition-colors duration-150 ${active ? "bg-primary-subtle" : "group-hover:border-border-faint"}`}
              >
                <span
                  className={`absolute inset-x-px bottom-0 transition-[height,opacity] duration-150 ${active ? "bg-primary-hover" : "bg-primary"}`}
                  style={{ height: `${height}%`, opacity: active ? 1 : 0.82 }}
                />
              </span>
            );
          })}
        </div>
      </div>

      <div className="type-label mt-2 flex min-h-4 items-center justify-between gap-3 text-[0.58rem] text-subtle">
        <span>
          {shortDay.format(new Date(`${points[0]!.day}T00:00:00Z`))} to{" "}
          {shortDay.format(new Date(`${points[points.length - 1]!.day}T00:00:00Z`))}
        </span>
        <span className="text-right">hover, tap, or focus a day</span>
      </div>
      <span aria-live="polite" className="sr-only">
        {selected ? pointLabel(selected) : ""}
      </span>
    </div>
  );
}
