import { MINT_KINK_USD, mintCurve } from "@tokenburnmarket/core";

/*
  The mint curve, drawn from the same function that mints credits. No client
  JavaScript and no chart library: it is one path, sampled from core, so the
  picture cannot drift away from the arithmetic.
*/

const WIDTH = 640;
const HEIGHT = 280;
const PAD = { top: 14, right: 14, bottom: 34, left: 46 };

/** Dollars on the x axis. Far enough past the kink that the tail is visible. */
const MAX_COST_USD = 200;
/** Credits on the y axis, rounded up past the curve's value at MAX_COST_USD. */
const MAX_CREDITS = 60;
const SAMPLES = 120;

const plotWidth = WIDTH - PAD.left - PAD.right;
const plotHeight = HEIGHT - PAD.top - PAD.bottom;

const x = (costUsd: number) => PAD.left + (costUsd / MAX_COST_USD) * plotWidth;
const y = (credits: number) => PAD.top + plotHeight - (credits / MAX_CREDITS) * plotHeight;

function curvePath(): string {
  const points: string[] = [];
  for (let i = 0; i <= SAMPLES; i += 1) {
    const cost = (i / SAMPLES) * MAX_COST_USD;
    points.push(`${x(cost).toFixed(2)},${y(mintCurve(cost)).toFixed(2)}`);
  }
  return `M ${points.join(" L ")}`;
}

/** Where a straight one-credit-per-dollar line would go, cut off at the top. */
function linearPath(): string {
  return `M ${x(0)},${y(0)} L ${x(MAX_CREDITS)},${y(MAX_CREDITS)}`;
}

const xTicks = [0, 20, 50, 100, 150, 200];
const yTicks = [0, 20, 40, 60];

export function MintCurveChart() {
  const kinkX = x(MINT_KINK_USD);
  const kinkY = y(mintCurve(MINT_KINK_USD));

  return (
    <figure className="rounded-(--radius-panel) border border-border bg-surface p-4 sm:p-6">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-labelledby="mint-curve-title mint-curve-desc"
      >
        <title id="mint-curve-title">Credits minted per day against usage cost</title>
        <desc id="mint-curve-desc">
          One credit per dollar up to {MINT_KINK_USD} dollars a day, then a square-root tail: 200
          dollars of usage in a day mints about {Math.round(mintCurve(MAX_COST_USD))} credits, not
          200.
        </desc>

        {yTicks.map((credits) => (
          <g key={`y-${credits}`}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(credits)}
              y2={y(credits)}
              stroke="var(--border-faint)"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 10}
              y={y(credits) + 4}
              textAnchor="end"
              className="type-data"
              fontSize="11"
              fill="var(--subtle-foreground)"
            >
              {credits}
            </text>
          </g>
        ))}

        {xTicks.map((cost) => (
          <text
            key={`x-${cost}`}
            x={x(cost)}
            y={HEIGHT - PAD.bottom + 18}
            textAnchor="middle"
            className="type-data"
            fontSize="11"
            fill="var(--subtle-foreground)"
          >
            ${cost}
          </text>
        ))}

        <path
          d={linearPath()}
          fill="none"
          stroke="var(--border-strong)"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
        <text
          x={x(MAX_CREDITS) + 8}
          y={y(MAX_CREDITS) + 14}
          className="type-data"
          fontSize="11"
          fill="var(--subtle-foreground)"
        >
          one credit per dollar
        </text>

        <path d={curvePath()} fill="none" stroke="var(--primary)" strokeWidth="2" />

        <line
          x1={kinkX}
          x2={kinkX}
          y1={kinkY}
          y2={HEIGHT - PAD.bottom}
          stroke="var(--border-strong)"
          strokeWidth="1"
          strokeDasharray="2 4"
        />
        <circle cx={kinkX} cy={kinkY} r="3" fill="var(--primary)" />
        <text
          x={kinkX + 10}
          y={kinkY + 22}
          className="type-data"
          fontSize="11"
          fill="var(--muted-foreground)"
        >
          kink at ${MINT_KINK_USD}
        </text>

        <line
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={HEIGHT - PAD.bottom}
          y2={HEIGHT - PAD.bottom}
          stroke="var(--border)"
          strokeWidth="1"
        />
      </svg>
      <figcaption className="type-label mt-4 text-subtle">
        credits minted (y) against a day of usage cost in usd (x)
      </figcaption>
    </figure>
  );
}
