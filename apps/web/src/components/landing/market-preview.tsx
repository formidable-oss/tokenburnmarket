import Link from "next/link";
import { Badge } from "@/components/ui/badge";

/*
  The market anatomy on the landing page: outcome label, probability bar, price
  in cents. It renders the busiest open Market when there is one, and the example
  below when the site has none yet, so a cold install still shows what this is.
*/

export interface PreviewOutcome {
  label: string;
  price: number;
  /** Only the example carries a Trust badge; a real Outcome label is not always a Builder. */
  trust?: "verified" | "reported";
}

export interface MarketPreviewData {
  href: string;
  /** "formidable · this week", or "global · this week". */
  where: string;
  question: string;
  /** Credits staked so far, formatted. */
  inPlay: string;
  closes: string;
  outcomes: PreviewOutcome[];
}

const EXAMPLE: MarketPreviewData = {
  href: "/markets",
  where: "global · this week",
  question: "Which model burns most this week?",
  inPlay: "1,240 cr in play",
  closes: "closes Sun 23:59 UTC",
  outcomes: [
    { label: "GPT-5.6 Sol", price: 0.44 },
    { label: "Claude Fable 5", price: 0.27 },
    { label: "Claude Opus 5", price: 0.19 },
    { label: "Ox Alpha", price: 0.1 },
  ],
};

const PREVIEW_OUTCOMES = 4;

export function MarketPreview({ market }: { market?: MarketPreviewData }) {
  const data = market ?? EXAMPLE;
  const example = market === undefined;
  const outcomes = [...data.outcomes].sort((a, b) => b.price - a.price).slice(0, PREVIEW_OUTCOMES);
  const top = outcomes[0];

  return (
    <section
      aria-label={example ? "Example market" : "Most active market"}
      className="relative rounded-(--radius-panel) border border-border bg-surface p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span aria-hidden className="ember-pulse size-1.5 rounded-full bg-ember" />
        <span className="type-label whitespace-nowrap text-[0.66rem]">
          {example ? "example" : "live"} · {data.where}
        </span>
        <span className="type-data ml-auto whitespace-nowrap text-[0.72rem] text-subtle">
          {data.inPlay}
        </span>
      </div>

      <h2 className="type-heading mt-4">{data.question}</h2>

      <ol className="mt-5 space-y-3">
        {outcomes.map((outcome) => (
          <li key={outcome.label} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5">
            <div className="flex min-w-0 items-center gap-2 text-[0.95rem]">
              <span className="truncate">{outcome.label}</span>
              {outcome.trust ? <Badge tone={outcome.trust}>{outcome.trust}</Badge> : null}
            </div>
            <span className="type-data text-[0.95rem] text-cyber">
              {Math.round(outcome.price * 100)}¢
            </span>
            <div className="col-span-2 h-1.5 overflow-hidden rounded-sm bg-surface-sunken">
              <div
                className="h-full rounded-sm bg-primary"
                style={{ width: `${outcome.price * 100}%` }}
                aria-hidden
              />
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-6 flex items-center gap-3">
        <span className="type-label text-[0.66rem]">{data.closes}</span>
        {top ? (
          example ? (
            <span className="ml-auto inline-flex h-9 items-center rounded-(--radius-control) bg-primary px-3.5 text-sm font-medium text-primary-foreground">
              Buy {top.label} · {Math.round(top.price * 100)}¢
            </span>
          ) : (
            <Link
              href={data.href}
              className="ml-auto inline-flex h-9 items-center rounded-(--radius-control) bg-primary px-3.5 text-sm font-medium text-primary-foreground"
            >
              Buy {top.label} · {Math.round(top.price * 100)}¢
            </Link>
          )
        ) : null}
      </div>
    </section>
  );
}
