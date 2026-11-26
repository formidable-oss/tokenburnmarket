import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ModelBurnChart } from "@/components/landing/model-burn-chart";
import { RegionBoards, type RegionBoardPreview } from "@/components/landing/region-boards";
import { StatsStrip } from "@/components/landing/stats-strip";
import { Steps } from "@/components/landing/steps";
import { formatMetric } from "@/components/leaderboard/board-table";
import { modelBurnChartData, statCells } from "@/lib/landing";
import { PERIOD_LABELS } from "@/lib/leaderboard";
import { BOARD_PREVIEW_LIMIT, cachedBoard, scopeForRegion } from "@/lib/leaderboard-queries";
import {
  MODEL_BURN_SEASON,
  cachedGlobalModelBurnDays,
  cachedSiteStats,
} from "@/lib/market-queries";
import { regionBySlug } from "@/lib/regions";

export const metadata: Metadata = {
  title: "tokenburnmarket. Bet your burn.",
  description:
    "Connect your machine, let your agent usage mint credits, then bet them on who burns most this week. Play money, real bragging rights, honest verification.",
};

const shell = "mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-12";

/*
  The landing preview shows the world, three busy continents and Romania. The
  full set of Regions lives at /leaderboard; five tabs is as much as a landing
  section can carry without becoming the leaderboard page.
*/
const PREVIEW_REGIONS = ["world", "europe", "north-america", "asia", "ro"];

async function previewBoards(): Promise<RegionBoardPreview[]> {
  const regions = PREVIEW_REGIONS.map((slug) => regionBySlug(slug)).filter(
    (region) => region !== null,
  );

  return Promise.all(
    regions.map(async (region) => {
      const board = await cachedBoard({
        scope: scopeForRegion(region),
        period: "week",
        metric: "cost",
        limit: BOARD_PREVIEW_LIMIT,
        // Eight rows is too shallow for a rank change to mean anything.
        comparePrevious: false,
      });
      return {
        slug: region.slug,
        name: region.name,
        rows: board.rows,
        caption: `${formatMetric(board.total, "cost")} ${PERIOD_LABELS.week}`,
      };
    }),
  );
}

export default async function Home() {
  // One clock reading for the Season and for today, so both name the same month at midnight.
  const now = new Date();
  const [boards, stats, modelBurnDays] = await Promise.all([
    previewBoards(),
    cachedSiteStats(),
    cachedGlobalModelBurnDays(now),
  ]);
  const today = now.toISOString().slice(0, 10);
  const modelBurn = modelBurnChartData(modelBurnDays, today, PERIOD_LABELS[MODEL_BURN_SEASON]);

  return (
    <>
      {/* Hero */}
      <section className={`${shell} grid items-end gap-14 pb-20 pt-14 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16 lg:pb-24 lg:pt-20`}>
        <div>
          <h1 className="type-display type-display-hero rise" style={{ "--i": 0 } as React.CSSProperties}>
            Bet your <span className="block">burn.</span>
          </h1>
          <p className="rise mt-7 max-w-[44ch] text-[1.1rem] text-muted" style={{ "--i": 1 } as React.CSSProperties}>
            Play-money prediction markets for AI coding agents. Your agent usage becomes credits. Credits become bets on who burns what next.
          </p>

          <div className="rise mt-9" style={{ "--i": 2 } as React.CSSProperties}>
            <div className="flex flex-wrap gap-3">
              <Button as={Link} href="/docs/setup">
                Get the setup prompt
              </Button>
              <Button as={Link} href="/leaderboard" variant="secondary">
                See the leaderboards
              </Button>
            </div>
            <p className="mt-4 max-w-[30rem] text-[0.82rem] text-subtle">
              Your agent installs the collector. Usage stays synced after that.
            </p>
          </div>
        </div>

        <div className="rise" style={{ "--i": 1 } as React.CSSProperties}>
          <ModelBurnChart data={modelBurn} />
        </div>
      </section>

      <div className={shell}>
        <div className="signal-rail" aria-hidden />
      </div>

      {/* Live stats */}
      <section className={`${shell} py-10 lg:py-12`} aria-label="Site totals">
        <StatsStrip cells={statCells(stats)} />
      </section>

      <div className={shell}>
        <div className="signal-rail" aria-hidden />
      </div>

      {/* How it works */}
      <section
        className={`${shell} grid gap-x-16 gap-y-10 py-20 lg:grid-cols-[0.8fr_1.2fr] lg:py-24`}
        aria-labelledby="how"
      >
        <div>
          <h2 id="how" className="type-heading">
            How it works.
          </h2>
          <p className="mt-3 max-w-[34ch] text-[0.95rem] text-muted">
            Only token counts, cost, and hashed message IDs leave your machine. Prompts and paths
            stay on it.
          </p>
          <Link href="/docs" className="mt-4 inline-block text-sm text-primary-text hover:underline">
            Read the docs
          </Link>
        </div>
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
        <RegionBoards boards={boards} metric="cost" season={PERIOD_LABELS.week} />
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
