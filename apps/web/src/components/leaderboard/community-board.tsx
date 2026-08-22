/*
  A Community Leaderboard. Same query, same table as a region board, scoped to
  the membership instead of to a country, so a Community reads its numbers the
  way the world does.

  Used twice: a short panel on /c/[slug], and the full board with switches at
  /c/[slug]/leaderboard.
*/
import { BoardSwitches, type BoardQuery } from "@/components/leaderboard/board-controls";
import { BoardTable, formatMetric } from "@/components/leaderboard/board-table";
import { PERIOD_LABELS } from "@/lib/leaderboard";
import { cachedBoard } from "@/lib/leaderboard-queries";

export async function CommunityBoard({
  community,
  query,
  limit,
  showSwitches = false,
}: {
  community: { id: string; slug: string; name: string };
  query: BoardQuery;
  limit?: number;
  showSwitches?: boolean;
}) {
  const board = await cachedBoard({
    scope: { kind: "community", communityId: community.id },
    period: query.period,
    metric: query.metric,
    limit,
  });
  const season = PERIOD_LABELS[query.period];

  return (
    <div>
      {showSwitches ? (
        <div className="mb-6">
          <BoardSwitches path={`/c/${community.slug}/leaderboard`} query={query} />
        </div>
      ) : null}
      <BoardTable
        rows={board.rows}
        metric={query.metric}
        label={`${community.name} · ${season}`}
        caption={`${formatMetric(board.total, query.metric)} ${season}`}
        empty="No burn here yet. Members show up within a few minutes of their first sync."
        showRankChange={query.period !== "all"}
      />
    </div>
  );
}
