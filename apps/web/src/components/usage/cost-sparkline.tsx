/*
  Daily burn, drawn server side as one SVG. No client JavaScript, no chart
  library: thirty numbers do not need one.

  Bars rather than a line, because a day with no usage should read as a gap and
  not as a slope between the days around it. The track is the sunken surface,
  the bars are the one yellow.
*/
import type { UsageDayPoint } from "@/lib/usage";

const HEIGHT = 40;
const SLOT = 4;
const GAP = 1;

const money = (usd: number) =>
  usd.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export function CostSparkline({ points }: { points: readonly UsageDayPoint[] }) {
  if (points.length === 0) return null;

  const peak = Math.max(...points.map((point) => point.costUsd));
  const width = points.length * SLOT;
  const busiest = points.reduce((a, b) => (b.costUsd > a.costUsd ? b : a));

  return (
    <svg
      viewBox={`0 0 ${width} ${HEIGHT}`}
      preserveAspectRatio="none"
      className="h-16 w-full"
      role="img"
      aria-label={`Daily cost over the last ${points.length} days. Highest day ${busiest.day}, ${money(busiest.costUsd)}.`}
    >
      <rect x="0" y={HEIGHT - 1} width={width} height="1" className="fill-border" />
      {points.map((point, index) => {
        // A day with usage never rounds to nothing: one pixel says "this happened".
        const height = peak === 0 ? 0 : Math.max(point.costUsd > 0 ? 1 : 0, (point.costUsd / peak) * (HEIGHT - 2));
        return (
          <rect
            key={point.day}
            x={index * SLOT}
            y={HEIGHT - 1 - height}
            width={SLOT - GAP}
            height={height}
            className="fill-primary"
          />
        );
      })}
    </svg>
  );
}
