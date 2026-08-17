import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Markets",
  description:
    "The four market templates, how the house prices them, the slippage rule, and how a market resolves, holds or voids.",
  alternates: { canonical: "/docs/markets" },
};

/*
  The rules described here are packages/core: market-templates.ts for the
  questions, lmsr.ts for the pricing and the slippage tolerance, resolve.ts and
  apps/web/src/lib/resolution.ts for settlement. Change them together.
*/
const templates = [
  {
    name: "Top Burner",
    question: "Who spends the most over the period?",
    detail:
      "One outcome per member, most likely winner first, then someone else for anyone not named. That last row is why a community that gains a member mid-week still has a market that can settle. Ranked on cost, then tokens, then handle.",
  },
  {
    name: "Threshold",
    question: "Will one builder reach an amount?",
    detail:
      "Two outcomes: reached, or not. A builder with no usage at all has not reached it, which is an answer rather than missing data.",
  },
  {
    name: "Head-to-Head",
    question: "Does A out-burn B?",
    detail: "Two outcomes, one per builder. An exact tie voids the market, including nil to nil.",
  },
  {
    name: "Model Race",
    question: "Which model burns the most tokens?",
    detail:
      "Up to seven named models plus another model. Global and regional only. Ranked on tokens across everyone in scope.",
  },
] as const;

export default function DocsMarketsPage() {
  return (
    <article>
      <p className="type-label">docs / markets</p>
      <h1 className="type-heading mt-3">A question, a clock, and a price.</h1>
      <p className="mt-4 text-[1.05rem] text-muted">
        Every market asks about future usage, closes at a fixed time, and settles from the same
        numbers that feed the leaderboards. A winning share pays 1 credit. Losing shares pay
        nothing.
      </p>

      <div className="signal-rail my-10" aria-hidden />

      <h2 className="type-heading">The four questions</h2>
      <p className="mt-3 text-[0.95rem] text-muted">
        A market is a template plus parameters, never free text, because a resolver has to settle
        it without asking anyone. Communities get the first three. A market carries at most eight
        outcomes.
      </p>
      <dl className="mt-6 grid gap-px overflow-hidden rounded-(--radius-panel) border border-border bg-border">
        {templates.map((template) => (
          <div key={template.name} className="bg-surface px-5 py-4">
            <dt>
              <span className="type-data text-[0.95rem] text-foreground">{template.name}</span>
              <span className="ml-3 text-[0.9rem] text-subtle">{template.question}</span>
            </dt>
            <dd className="mt-2 text-[0.95rem] text-muted">{template.detail}</dd>
          </div>
        ))}
      </dl>

      <div className="signal-rail my-10" aria-hidden />

      <h2 className="type-heading">How the price works</h2>
      <p className="mt-3 text-[0.95rem] text-muted">
        There is no order book and no waiting for someone to take the other side. The house is
        always the counterparty and always quotes, using a rule called LMSR. In plain words:
      </p>
      <ul className="mt-4 space-y-3 text-[0.95rem] text-muted">
        <li>
          Every outcome has a price between 0 and 1, and the prices of a market add up to 1. Read a
          price as the crowd&apos;s probability. An outcome at 0.32 costs 32 hundredths of a credit
          per share and pays 1 credit if it wins.
        </li>
        <li>
          Buying an outcome pushes its price up and the others down. Selling does the reverse. How
          hard your trade moves the price depends on the market&apos;s depth, which is set from how
          many people can trade it: a five-person community moves on a small bet, a world market
          barely notices one.
        </li>
        <li>
          Because the price moves while you buy, you pay an average of the prices you walked
          through, never the price you started at. The quote you are shown is that average.
        </li>
        <li>
          You can sell back at any time before close, at whatever the price is then. Costs round up
          and proceeds round down to four decimals, so buying and immediately selling can never
          make money out of rounding.
        </li>
        <li>
          No fees in v1. The house takes the other side and can lose credits, which is fine: the
          most it can lose on a market is bounded when the market is created.
        </li>
      </ul>

      <div className="signal-rail my-10" aria-hidden />

      <h2 className="type-heading">Slippage</h2>
      <p className="mt-3 text-[0.95rem] text-muted">
        A quote is an offer, not a promise. Between seeing a price and confirming, someone else can
        trade. When your order arrives the server re-prices it under a lock and compares the
        average price it got with the one you were shown.
      </p>
      <p className="mt-3 text-[0.95rem] text-muted">
        If the price moved against you by more than 1 percent, the trade is refused and nothing is
        spent. You see the new quote and decide again. A move in your favour is never a reason to
        refuse, and you can accept slippage explicitly if you would rather have the fill than the
        price.
      </p>

      <div className="signal-rail my-10" aria-hidden />

      <h2 className="type-heading">Closing and resolution</h2>
      <ul className="mt-4 space-y-3 text-[0.95rem] text-muted">
        <li>
          A market stops taking trades the moment its close time passes. That is the clock, not a
          job.
        </li>
        <li>
          The resolver runs every ten minutes. It reads usage over the market&apos;s period, works
          out the winning outcome, and pays 1 credit per winning share.
        </li>
        <li>
          Usage arrives late, so a market&apos;s period ends before its close time. Devices have a
          couple of days to backfill, and the daily mint runs at 01:00 UTC over closed days.
        </li>
      </ul>

      <h3 className="type-label mt-8">holds</h3>
      <p className="mt-3 text-[0.95rem] text-muted">
        If any usage the market points at is quarantined, the market holds instead of resolving. An
        answer computed from data under review is worse than no answer. A hold clears the moment
        the review does. If that has not happened 24 hours later, the market voids.
      </p>

      <h3 className="type-label mt-8">voids</h3>
      <p className="mt-3 text-[0.95rem] text-muted">
        A voided market refunds every position at exactly what it cost, so a void is neutral for
        everyone. It happens when a head-to-head ties, when nobody in scope burned anything over
        the period, or when a hold runs out.
      </p>

      <div className="signal-rail my-10" aria-hidden />

      <h2 className="type-heading">Who can open one</h2>
      <p className="mt-3 text-[0.95rem] text-muted">
        Community markets need membership, and the owner can reserve creation to themselves. Global
        and regional markets are admin only. The weekly community markets open themselves on Monday
        morning UTC.
      </p>
      <p className="mt-6 text-[0.95rem] text-muted">
        Where the price rule comes from:{" "}
        <a
          className="text-primary-text hover:underline"
          href="https://github.com/formidable-oss/tokenburnmarket/blob/main/docs/adr/0002-lmsr-house-backed-market-maker.md"
        >
          ADR 0002
        </a>
        . What settles a market is the same usage described under{" "}
        <Link href="/docs/verification" className="text-primary-text hover:underline">
          verification
        </Link>
        .
      </p>
    </article>
  );
}
