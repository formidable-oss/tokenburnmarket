import { Badge } from "@/components/ui/badge";

/*
  Static preview of a community market. Numbers are illustrative.
  The real market page (issue #9) should reuse this row anatomy:
  outcome label, probability bar, price in cents.
*/
const outcomes = [
  { handle: "@alex", price: 0.42, verified: true },
  { handle: "@theo", price: 0.31, verified: true },
  { handle: "@mira", price: 0.19, verified: false },
  { handle: "someone else", price: 0.08, verified: true },
];

export function MarketPreview() {
  return (
    <section
      aria-label="Example market"
      className="relative rounded-(--radius-panel) border border-border bg-surface p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span aria-hidden className="ember-pulse size-1.5 rounded-full bg-ember" />
        <span className="type-label whitespace-nowrap text-[0.66rem]">live · formidable · this week</span>
        <span className="type-data ml-auto whitespace-nowrap text-[0.72rem] text-subtle">1,240 cr in play</span>
      </div>

      <h2 className="type-heading mt-4">Who burns most this week?</h2>

      <ol className="mt-5 space-y-3">
        {outcomes.map((o) => (
          <li key={o.handle} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5">
            <div className="flex items-center gap-2 text-[0.95rem]">
              <span>{o.handle}</span>
              {o.handle !== "someone else" && (
                <Badge tone={o.verified ? "verified" : "reported"}>{o.verified ? "verified" : "reported"}</Badge>
              )}
            </div>
            <span className="type-data text-[0.95rem] text-cyber">{Math.round(o.price * 100)}¢</span>
            <div className="col-span-2 h-1.5 overflow-hidden rounded-sm bg-surface-sunken">
              <div
                className="h-full rounded-sm bg-primary"
                style={{ width: `${o.price * 100}%` }}
                aria-hidden
              />
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-6 flex items-center gap-3">
        <span className="type-label text-[0.66rem]">closes Sun 23:59 UTC</span>
        <span className="ml-auto inline-flex h-9 items-center rounded-(--radius-control) bg-primary px-3.5 text-sm font-medium text-primary-foreground">
          Buy @alex · 42¢
        </span>
      </div>
    </section>
  );
}
