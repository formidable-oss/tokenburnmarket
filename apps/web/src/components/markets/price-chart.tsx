/*
  Price history, drawn server side as one SVG. No client JavaScript and no chart
  library: a few hundred points do not need one.

  Every fill carries the price it left behind, so a Market's own trade tape is
  its chart. Between two fills of an outcome the price did not move, which is
  why the lines are stepped: a slope there would be a claim nobody made.

  One yellow per view means the chart cannot spend it. Prices are cyan, the
  colour reserved for anything forward looking, and each line is labelled at its
  right edge so the reader never has to match a colour to a legend.
*/
import { formatPriceCents } from "@/lib/markets";
import type { OutcomePrice, PricePoint } from "@/lib/market-queries";

const WIDTH = 640;
const HEIGHT = 180;
const RIGHT_GUTTER = 96;
const PLOT = WIDTH - RIGHT_GUTTER;

/** Opacity per line, so several outcomes stay distinguishable inside one hue. */
const SHADES = [1, 0.68, 0.46, 0.32, 0.24, 0.2, 0.17, 0.15];

export function PriceChart({
  history,
  outcomes,
}: {
  history: readonly PricePoint[];
  outcomes: readonly OutcomePrice[];
}) {
  if (history.length < 2) {
    return (
      <p className="text-[0.9rem] text-subtle">
        The chart starts once this market has been traded a couple of times.
      </p>
    );
  }

  const start = history[0].at.getTime();
  const span = Math.max(1, history[history.length - 1].at.getTime() - start);
  const x = (at: Date) => ((at.getTime() - start) / span) * PLOT;
  const y = (price: number) => HEIGHT - 8 - price * (HEIGHT - 24);

  const lines = outcomes.map((outcome, index) => {
    /*
      An outcome's price also moves when a different outcome is traded, but the
      tape only records the traded one. Reading just this outcome's fills tracks
      where it was quoted last, which is the honest line to draw from a tape.
    */
    const points = history.filter((point) => point.outcomeId === outcome.id);
    const segments: string[] = [];
    let previous: PricePoint | null = null;
    for (const point of points) {
      if (previous === null) segments.push(`M ${x(point.at).toFixed(2)} ${y(point.price).toFixed(2)}`);
      else {
        segments.push(`L ${x(point.at).toFixed(2)} ${y(previous.price).toFixed(2)}`);
        segments.push(`L ${x(point.at).toFixed(2)} ${y(point.price).toFixed(2)}`);
      }
      previous = point;
    }
    // Carry the last quote to the right edge: it is still the price right now.
    if (previous) segments.push(`L ${PLOT.toFixed(2)} ${y(previous.price).toFixed(2)}`);

    return {
      outcome,
      path: segments.join(" "),
      last: previous?.price ?? outcome.price,
      shade: SHADES[index] ?? 0.15,
    };
  });

  const traded = lines.filter((line) => line.path !== "");

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-44 w-full"
      role="img"
      aria-label={`Price history. ${outcomes
        .map((outcome) => `${outcome.label} at ${formatPriceCents(outcome.price)}`)
        .join(", ")}.`}
    >
      {[0, 0.5, 1].map((level) => (
        <line
          key={level}
          x1="0"
          x2={PLOT}
          y1={y(level)}
          y2={y(level)}
          className="stroke-border-faint"
          strokeWidth="1"
        />
      ))}
      <text x={PLOT + 6} y={y(1) + 4} className="fill-[color:var(--subtle-foreground)] text-[9px]">
        100¢
      </text>
      <text x={PLOT + 6} y={y(0) + 4} className="fill-[color:var(--subtle-foreground)] text-[9px]">
        0¢
      </text>

      {traded.map((line) => (
        <g key={line.outcome.id}>
          <path
            d={line.path}
            fill="none"
            className="stroke-[color:var(--cyber)]"
            strokeOpacity={line.shade}
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <text
            x={PLOT + 6}
            y={Math.min(HEIGHT - 4, Math.max(10, y(line.last) + 3))}
            className="fill-[color:var(--cyber)] text-[9px]"
            fillOpacity={line.shade}
          >
            {line.outcome.label.slice(0, 12)}
          </text>
        </g>
      ))}
    </svg>
  );
}
