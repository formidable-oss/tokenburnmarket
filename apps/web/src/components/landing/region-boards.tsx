"use client";

import { useState } from "react";
import { BoardTable } from "@/components/leaderboard/board-table";
import type { BoardRow, Metric } from "@/lib/leaderboard";

/*
  Landing Leaderboards by region: one tab strip, one dense table, the same
  columns as /leaderboard because it is the same table component. Real numbers,
  fetched on the server and handed down, so switching a tab costs no request.

  Regions are the world, continents, and countries; Romania sits first among
  countries because that is where the crew is.
*/
export interface RegionBoardPreview {
  slug: string;
  name: string;
  rows: BoardRow[];
  /** The scope total, already formatted, such as "$48,210 this week". */
  caption: string;
}

export function RegionBoards({
  boards,
  metric,
  season,
}: {
  boards: RegionBoardPreview[];
  metric: Metric;
  season: string;
}) {
  const [active, setActive] = useState(boards[0]?.slug ?? "world");
  const board = boards.find((b) => b.slug === active) ?? boards[0];
  if (!board) return null;

  return (
    <div>
      <div
        role="tablist"
        aria-label="Region"
        className="flex flex-wrap gap-1 border-b border-border-faint"
      >
        {boards.map((b) => {
          const selected = b.slug === active;
          return (
            <button
              key={b.slug}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`board-${b.slug}`}
              onClick={() => setActive(b.slug)}
              className={`relative -mb-px h-10 px-3 text-sm transition-colors ${
                selected ? "text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {b.name}
              <span
                aria-hidden
                className={`absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary transition-transform duration-200 ease-(--ease-out-expo) ${
                  selected ? "scale-x-100" : "scale-x-0"
                }`}
              />
            </button>
          );
        })}
      </div>

      <div id={`board-${board.slug}`} role="tabpanel" className="mt-4">
        <BoardTable
          rows={board.rows}
          metric={metric}
          label={`${board.name} · ${season}`}
          caption={board.caption}
          showRankChange={false}
        />
      </div>
    </div>
  );
}
