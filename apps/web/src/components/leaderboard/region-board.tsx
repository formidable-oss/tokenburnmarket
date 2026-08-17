/*
  A region Leaderboard page body: the tab strip, the switches, one table.
  /leaderboard and /leaderboard/[region] are the same page with a different
  Region, so they share this.

  The tab strip is the only part that depends on the viewer: their own country
  gets a tab once they have declared one. The board itself is anonymous and
  comes from the cached query.
*/
import { currentBuilder } from "@/auth";
import { BoardSwitches, RegionTabs, type BoardQuery } from "@/components/leaderboard/board-controls";
import { BoardTable, formatMetric } from "@/components/leaderboard/board-table";
import { PERIOD_LABELS } from "@/lib/leaderboard";
import { cachedBoard, scopeForRegion } from "@/lib/leaderboard-queries";
import { regionTabs, type Region } from "@/lib/regions";

export async function RegionBoard({ region, query }: { region: Region; query: BoardQuery }) {
  const [viewer, board] = await Promise.all([
    currentBuilder(),
    cachedBoard({ scope: scopeForRegion(region), period: query.period, metric: query.metric }),
  ]);

  const path = region.slug === "world" ? "/leaderboard" : `/leaderboard/${region.slug}`;
  const season = PERIOD_LABELS[query.period];

  return (
    <section className="mx-auto max-w-[1200px] px-4 pb-24 pt-14 sm:px-6 lg:px-12">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="type-label">leaderboard</p>
          <h1 className="type-heading mt-3">{region.name}</h1>
          <p className="type-data mt-2 text-[0.8rem] text-subtle">
            {board.range.start ? `${board.range.start} to ${board.range.end}` : "every day so far"}
            {" UTC"}
          </p>
        </div>
        <BoardSwitches path={path} query={query} />
      </header>

      <div className="signal-rail my-10" aria-hidden />

      <RegionTabs regions={regionTabs(viewer?.country)} active={region.slug} query={query} />

      <div className="mt-4">
        <BoardTable
          rows={board.rows}
          metric={query.metric}
          label={`${region.name} · ${season}`}
          caption={`${formatMetric(board.total, query.metric)} ${season}`}
          showRankChange={query.period !== "all"}
        />
      </div>

      <p className="mt-6 max-w-[56ch] text-[0.85rem] text-subtle">
        Reported means the agent gives us no message identifiers to check against. Quarantined days
        are left out entirely. A Builder without a declared country is on the world board only.
      </p>
    </section>
  );
}
