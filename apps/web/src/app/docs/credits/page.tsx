import type { Metadata } from "next";
import Link from "next/link";
import {
  MINT_KINK_USD,
  REPORTED_MINT_MULTIPLIER,
  SIGNUP_GRANT_CREDITS,
  mintCurve,
} from "@tokenburnmarket/core";
import { MintCurveChart } from "./mint-curve";

export const metadata: Metadata = {
  title: "Credits",
  description:
    "How credits are minted from usage: the curve, the kink, the reported discount, the signup grant, and why there is no way to buy them.",
  alternates: { canonical: "/docs/credits" },
};

/** Sampled from the same function that mints, so the table cannot go stale. */
const examples = [1, 5, 20, 50, 100, 200];

export default function DocsCreditsPage() {
  return (
    <article>
      <p className="type-label">docs / credits</p>
      <h1 className="type-heading mt-3">Whales earn more, not proportionally more.</h1>
      <p className="mt-4 text-[1.05rem] text-muted">
        Credits are the play currency. They come from what your agents cost, on a curve that
        flattens above a daily kink, so a bigger bill buys you a head start rather than the whole
        game. There is no way to buy them and no way to cash them out.
      </p>

      <div className="signal-rail my-10" aria-hidden />

      <h2 className="type-heading">The curve</h2>
      <p className="mt-3 text-[0.95rem] text-muted">
        Per builder, per UTC day, from the cost of that day&apos;s usage across all your devices,
        priced by ccusage:
      </p>
      <p className="type-data mt-4 rounded-(--radius-panel) border border-border bg-surface-sunken px-4 py-3 text-[0.95rem] text-foreground">
        mint = min(cost, {MINT_KINK_USD}) + 2 * sqrt(max(cost - {MINT_KINK_USD}, 0))
      </p>
      <p className="mt-4 text-[0.95rem] text-muted">
        One credit per dollar up to ${MINT_KINK_USD} a day. Past that, the tail grows with the
        square root of what you spent above the kink.
      </p>

      <div className="mt-6">
        <MintCurveChart />
      </div>

      <table className="mt-8 w-full border-collapse text-left text-[0.92rem]">
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="type-label py-2 pr-4 font-normal">
              a day that cost
            </th>
            <th scope="col" className="type-label py-2 pr-4 text-right font-normal">
              verified
            </th>
            <th scope="col" className="type-label py-2 text-right font-normal">
              reported
            </th>
          </tr>
        </thead>
        <tbody className="text-muted">
          {examples.map((cost) => (
            <tr key={cost} className="border-b border-border-faint">
              <td className="type-data py-2.5 pr-4 tabular-nums text-foreground">${cost}</td>
              <td className="type-data py-2.5 pr-4 text-right tabular-nums">
                {mintCurve(cost).toFixed(1)}
              </td>
              <td className="type-data py-2.5 text-right tabular-nums">
                {(mintCurve(cost) * REPORTED_MINT_MULTIPLIER).toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[0.85rem] text-subtle">Credits, rounded to one decimal here.</p>

      <div className="signal-rail my-10" aria-hidden />

      <h2 className="type-heading">Trust changes what a day is worth</h2>
      <ul className="mt-4 space-y-3 text-[0.95rem] text-muted">
        <li>
          Verified usage mints the full curve.
        </li>
        <li>
          Reported usage mints half. No receipt stream means we cannot dedupe it or check it for
          coherence, so it is worth less, and the badge says so on the boards.
        </li>
        <li>
          Quarantined usage mints nothing while it is under review. If a review approves the day,
          the credits are added then. Nothing is ever clawed back from a day already minted.
        </li>
      </ul>
      <p className="mt-4 text-[0.95rem] text-muted">
        A day is minted at the weakest trust level among its rows, so one quarantined row holds the
        whole day. What the levels mean is on the{" "}
        <Link href="/docs/verification" className="text-primary-text hover:underline">
          verification
        </Link>{" "}
        page.
      </p>

      <div className="signal-rail my-10" aria-hidden />

      <h2 className="type-heading">When it lands</h2>
      <ul className="mt-4 space-y-3 text-[0.95rem] text-muted">
        <li>
          {SIGNUP_GRANT_CREDITS} credits when you sign up, so you can trade before your first day
          closes.
        </li>
        <li>
          The mint runs once a day, at 01:00 UTC, over days that have closed. Late syncs are
          expected, so a day is re-minted upward as more usage for it arrives.
        </li>
        <li>
          Re-minting only ever adds. If a day&apos;s usage grows, you get the difference; it never
          goes the other way.
        </li>
        <li>
          The curve is versioned. Every minted amount records which version produced it, so if the
          parameters ever change, history stays readable.
        </li>
      </ul>

      <div className="signal-rail my-10" aria-hidden />

      <h2 className="type-heading">Credits won</h2>
      <p className="mt-3 text-[0.95rem] text-muted">
        Over a period, credits won is what markets paid out plus what selling shares returned, less
        what buying them cost. The signup grant and the daily mint are not winnings. It is the
        third leaderboard metric, next to cost and tokens, and the only one that rewards being
        right rather than spending.
      </p>

      <div className="signal-rail my-10" aria-hidden />

      <h2 className="type-heading">No cash, either direction</h2>
      <p className="mt-3 text-[0.95rem] text-muted">
        Credits cannot be bought, sold, transferred, or withdrawn. There is no payment path in the
        product and no plan to add one. That is a deliberate design decision, not a launch
        limitation: with no money in and no money out, this is a game about reading your friends
        correctly.
      </p>
      <p className="mt-6 text-[0.95rem] text-muted">
        The reasoning behind the parameters is in{" "}
        <a
          className="text-primary-text hover:underline"
          href="https://github.com/formidable-oss/tokenburnmarket/blob/main/docs/adr/0004-curved-daily-credit-mint.md"
        >
          ADR 0004
        </a>
        . What you can do with credits is on the{" "}
        <Link href="/docs/markets" className="text-primary-text hover:underline">
          markets
        </Link>{" "}
        page.
      </p>
    </article>
  );
}
