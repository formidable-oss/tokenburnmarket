import { Badge } from "@/components/ui/badge";

/* Static preview. Real boards (issue #8) keep this density: one line per builder, numbers aligned. */
const rows = [
  { rank: 1, handle: "@theo", burn: "$1,284", credits: "+312", trust: "verified" as const, delta: "▲2" },
  { rank: 2, handle: "@alex", burn: "$962", credits: "+518", trust: "verified" as const, delta: "▼1" },
  { rank: 3, handle: "@mira", burn: "$740", credits: "−40", trust: "reported" as const, delta: "▲5" },
  { rank: 4, handle: "@dan", burn: "$611", credits: "+87", trust: "verified" as const, delta: "" },
  { rank: 5, handle: "@yuki", burn: "$588", credits: "+205", trust: "verified" as const, delta: "▲1" },
];

export function LeaderboardPreview() {
  return (
    <div className="rounded-(--radius-panel) border border-border bg-surface">
      <div className="flex items-center gap-3 border-b border-border-faint px-5 py-3">
        <span className="type-label text-[0.66rem]">global · this week</span>
        <span className="type-label ml-auto text-[0.66rem] text-subtle">burn · credits won</span>
      </div>
      <ol>
        {rows.map((r) => (
          <li
            key={r.handle}
            className="grid grid-cols-[2rem_1fr_auto_auto] items-center gap-x-4 border-b border-border-faint px-5 py-2.5 last:border-b-0 sm:grid-cols-[2rem_1fr_5.5rem_4.5rem_2.5rem]"
          >
            <span className="type-data text-[0.8rem] text-subtle">{String(r.rank).padStart(2, "0")}</span>
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
            <span className="type-data hidden text-right text-[0.72rem] text-subtle sm:block">{r.delta}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
