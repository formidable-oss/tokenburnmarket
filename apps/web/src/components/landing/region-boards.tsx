"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";

/*
  Landing leaderboards by region. Static preview data; the real boards (issue #8)
  should keep this anatomy: one region tab strip, one dense table, same columns.
  Regions are the world, continents, and countries; Romania sits first among countries
  because that is where the crew is.
*/
type Trust = "verified" | "reported";
type Row = { handle: string; burn: string; credits: string; trust: Trust };
type Board = { key: string; label: string; total: string; rows: Row[] };

const boards: Board[] = [
  {
    key: "world",
    label: "World",
    total: "$48,210 this week",
    rows: [
      { handle: "@theo", burn: "$1,284", credits: "+312", trust: "verified" },
      { handle: "@alex", burn: "$962", credits: "+518", trust: "verified" },
      { handle: "@mira", burn: "$740", credits: "−40", trust: "reported" },
      { handle: "@dan", burn: "$611", credits: "+87", trust: "verified" },
      { handle: "@yuki", burn: "$588", credits: "+205", trust: "verified" },
      { handle: "@sam", burn: "$540", credits: "+12", trust: "verified" },
      { handle: "@lena", burn: "$497", credits: "+64", trust: "verified" },
      { handle: "@raj", burn: "$451", credits: "−18", trust: "reported" },
    ],
  },
  {
    key: "europe",
    label: "Europe",
    total: "$17,930 this week",
    rows: [
      { handle: "@alex", burn: "$962", credits: "+518", trust: "verified" },
      { handle: "@mira", burn: "$740", credits: "−40", trust: "reported" },
      { handle: "@lena", burn: "$497", credits: "+64", trust: "verified" },
      { handle: "@tomas", burn: "$430", credits: "+90", trust: "verified" },
      { handle: "@ines", burn: "$402", credits: "+21", trust: "verified" },
      { handle: "@pavel", burn: "$377", credits: "−5", trust: "verified" },
      { handle: "@noor", burn: "$351", credits: "+140", trust: "verified" },
      { handle: "@ewa", burn: "$298", credits: "+33", trust: "reported" },
    ],
  },
  {
    key: "romania",
    label: "Romania",
    total: "$4,120 this week",
    rows: [
      { handle: "@alex", burn: "$962", credits: "+518", trust: "verified" },
      { handle: "@andrei", burn: "$610", credits: "+72", trust: "verified" },
      { handle: "@ioana", burn: "$544", credits: "+119", trust: "verified" },
      { handle: "@vlad", burn: "$488", credits: "−30", trust: "verified" },
      { handle: "@raluca", burn: "$402", credits: "+8", trust: "reported" },
      { handle: "@mihai", burn: "$377", credits: "+45", trust: "verified" },
      { handle: "@ana", burn: "$310", credits: "+61", trust: "verified" },
      { handle: "@radu", burn: "$266", credits: "−12", trust: "verified" },
    ],
  },
  {
    key: "north-america",
    label: "North America",
    total: "$19,480 this week",
    rows: [
      { handle: "@theo", burn: "$1,284", credits: "+312", trust: "verified" },
      { handle: "@dan", burn: "$611", credits: "+87", trust: "verified" },
      { handle: "@sam", burn: "$540", credits: "+12", trust: "verified" },
      { handle: "@jess", burn: "$470", credits: "+150", trust: "verified" },
      { handle: "@marco", burn: "$433", credits: "−22", trust: "reported" },
      { handle: "@kai", burn: "$401", credits: "+38", trust: "verified" },
      { handle: "@priya", burn: "$389", credits: "+7", trust: "verified" },
      { handle: "@owen", burn: "$352", credits: "+94", trust: "verified" },
    ],
  },
  {
    key: "asia",
    label: "Asia",
    total: "$7,860 this week",
    rows: [
      { handle: "@yuki", burn: "$588", credits: "+205", trust: "verified" },
      { handle: "@raj", burn: "$451", credits: "−18", trust: "reported" },
      { handle: "@minh", burn: "$420", credits: "+55", trust: "verified" },
      { handle: "@haruto", burn: "$398", credits: "+13", trust: "verified" },
      { handle: "@wei", burn: "$366", credits: "+80", trust: "verified" },
      { handle: "@arjun", burn: "$340", credits: "−9", trust: "verified" },
      { handle: "@sora", burn: "$302", credits: "+27", trust: "verified" },
      { handle: "@dev", burn: "$275", credits: "+41", trust: "reported" },
    ],
  },
];

export function RegionBoards() {
  const [active, setActive] = useState(boards[0].key);
  const board = boards.find((b) => b.key === active) ?? boards[0];

  return (
    <div>
      <div role="tablist" aria-label="Region" className="flex flex-wrap gap-1 border-b border-border-faint">
        {boards.map((b) => {
          const selected = b.key === active;
          return (
            <button
              key={b.key}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`board-${b.key}`}
              onClick={() => setActive(b.key)}
              className={`relative -mb-px h-10 px-3 text-sm transition-colors ${
                selected ? "text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {b.label}
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

      <div id={`board-${board.key}`} role="tabpanel" className="mt-4 rounded-(--radius-panel) border border-border bg-surface">
        <div className="flex items-center gap-3 border-b border-border-faint px-5 py-3">
          <span className="type-label text-[0.66rem]">{board.label} · this week</span>
          <span className="type-data ml-auto text-[0.72rem] text-subtle">{board.total}</span>
        </div>
        <ol>
          {board.rows.map((r, i) => (
            <li
              key={r.handle}
              className="grid grid-cols-[2rem_1fr_auto_auto] items-center gap-x-4 border-b border-border-faint px-5 py-2.5 last:border-b-0 sm:grid-cols-[2rem_1fr_6rem_5rem]"
            >
              <span className="type-data text-[0.8rem] text-subtle">{String(i + 1).padStart(2, "0")}</span>
              <span className="flex items-center gap-2 text-[0.95rem]">
                {r.handle}
                <Badge tone={r.trust}>{r.trust}</Badge>
              </span>
              <span className="type-data text-right text-[0.95rem]">{r.burn}</span>
              <span
                className={`type-data text-right text-[0.9rem] ${r.credits.startsWith("+") ? "text-[color:var(--won)]" : "text-muted"}`}
              >
                {r.credits}
              </span>
            </li>
          ))}
        </ol>
        <div className="flex items-center gap-4 px-5 py-3">
          <span className="type-label text-[0.66rem] text-subtle">burn · credits won</span>
        </div>
      </div>
    </div>
  );
}
