/*
  The tokenburnmarket mark.
  Five stepped bars on a 9x9 pixel grid: read left to right it is a market depth chart,
  read as a silhouette it is a flame. The hottest pixel (top of the tallest bar) is the ember.
  An incomplete frame ties it to the Formidable family of marks.

  Contract: color comes from CSS variables so the mark adapts to theme; pass `size` in px.
  Keep the pixel map in sync with public/logo.svg and the favicon if you change it.
*/

const BAR_HEIGHTS = [3, 5, 9, 6, 4] as const; // out of 9 rows
const GRID = 9;

export function LogoMark({
  size = 28,
  className,
  title = "tokenburnmarket",
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  const cells: { x: number; y: number; ember: boolean }[] = [];
  BAR_HEIGHTS.forEach((h, i) => {
    const x = 2 + i;
    for (let r = 0; r < h; r++) {
      const y = GRID - 1 - r;
      cells.push({ x, y, ember: i === 2 && r === h - 1 });
    }
  });

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${GRID + 2} ${GRID + 2}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={title}
      className={className}
    >
      {/* incomplete frame: two corners, never a full box */}
      <path
        d="M0.5 3.5V0.5H3.5"
        fill="none"
        stroke="var(--foreground)"
        strokeWidth="1"
        opacity="0.55"
      />
      <path
        d="M10.5 7.5V10.5H7.5"
        fill="none"
        stroke="var(--foreground)"
        strokeWidth="1"
        opacity="0.55"
      />
      {cells.map((c) => (
        <rect
          key={`${c.x}-${c.y}`}
          x={c.x}
          y={c.y + 1}
          width="1"
          height="1"
          fill={c.ember ? "var(--ember)" : "var(--primary)"}
        />
      ))}
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={`font-sans font-semibold tracking-tight text-foreground ${className ?? ""}`}
    >
      token<span className="text-primary-text">burn</span>market
    </span>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={size} />
      <Wordmark className="text-[1.05rem]" />
    </span>
  );
}
