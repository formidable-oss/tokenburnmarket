import type { StatCell } from "@/lib/landing";

/*
  Four site numbers under the hero, on the signal rail. Pixel numerals, mono
  labels, no icons: the strip is a row of facts, not a feature grid.
*/
export function StatsStrip({ cells }: { cells: readonly StatCell[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">
      {cells.map((cell, index) => (
        <div key={cell.label} className="rise" style={{ "--i": index } as React.CSSProperties}>
          <dt className="type-label text-[0.66rem]">{cell.label}</dt>
          <dd className="type-heading mt-2 tabular-nums">{cell.value}</dd>
        </div>
      ))}
    </dl>
  );
}
