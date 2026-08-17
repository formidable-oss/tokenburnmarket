import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CommandLine } from "@/components/ui/command-line";
import { MarketPreview } from "@/components/landing/market-preview";
import { RegionBoards } from "@/components/landing/region-boards";
import { Steps } from "@/components/landing/steps";

export const metadata: Metadata = {
  title: "tokenburnmarket. Bet your burn.",
  description:
    "Connect your machine, let your agent usage mint credits, then bet them on who burns most this week. Play money, real bragging rights, honest verification.",
};

const shell = "mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-12";

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className={`${shell} grid items-center gap-12 pb-20 pt-16 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16 lg:pb-28 lg:pt-24`}>
        <div>
          <p className="type-label rise" style={{ "--i": 0 } as React.CSSProperties}>
            play-money prediction markets for AI coding agents
          </p>
          <h1 className="type-display rise mt-5" style={{ "--i": 1 } as React.CSSProperties}>
            Bet your <span className="text-primary">burn</span>.
          </h1>
          <p className="rise mt-6 max-w-[42ch] text-[1.1rem] text-muted" style={{ "--i": 2 } as React.CSSProperties}>
            Your agent usage becomes credits. Credits become bets on who burns what next.
          </p>

          <div className="rise mt-9 max-w-[30rem]" style={{ "--i": 3 } as React.CSSProperties}>
            <CommandLine command="npx tokenburnmarket connect" />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button as={Link} href="/signin" variant="secondary">
                Sign in with GitHub
              </Button>
              <span className="text-[0.82rem] text-subtle">
                Reads what ccusage reads. Nothing but totals leaves your machine.
              </span>
            </div>
          </div>
        </div>

        <div className="rise" style={{ "--i": 2 } as React.CSSProperties}>
          <MarketPreview />
        </div>
      </section>

      <div className={shell}>
        <div className="signal-rail" aria-hidden />
      </div>

      {/* How it works */}
      <section className={`${shell} py-20 lg:py-24`} aria-labelledby="how">
        <h2 id="how" className="type-label mb-12">how it works</h2>
        <Steps />
      </section>

      <div className={shell}>
        <div className="signal-rail" aria-hidden />
      </div>

      {/* Leaderboards by region */}
      <section className={`${shell} py-20 lg:py-24`} aria-labelledby="boards">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="boards" className="type-heading">
              Who is burning, everywhere.
            </h2>
            <p className="mt-3 max-w-[44ch] text-[0.95rem] text-muted">
              World, continent, and country boards run on the same numbers as your community. Pick a region.
            </p>
          </div>
          <Link href="/leaderboard" className="text-sm text-primary-text hover:underline">
            All leaderboards
          </Link>
        </div>
        <RegionBoards />
      </section>

      {/* Honesty strip */}
      <section className={`${shell} pb-24`}>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 border-l-2 border-ember pl-5">
          <p className="text-[1.05rem]">
            Verified means signed and plausible. <span className="text-muted">Not proof.</span>
          </p>
          <Link href="/docs/verification" className="text-sm text-muted hover:text-foreground hover:underline">
            How verification works
          </Link>
        </div>
      </section>
    </>
  );
}
