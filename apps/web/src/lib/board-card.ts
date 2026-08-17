/*
  The board share card, for a region and for a Community alike.

  A card has no query string, so it always shows the board's own default: this
  week, by cost. Anything else is a link someone chose, not a link someone shares.
*/
import { formatMetric } from "@/components/leaderboard/board-table";
import { boardCard, CARD_BOARD_ROWS, type ShareCard } from "@/lib/share-cards";
import { cachedBoard, type BoardScope } from "@/lib/leaderboard-queries";

export const CARD_PERIOD = "week" as const;
export const CARD_METRIC = "cost" as const;

export async function boardShareCard(
  scope: BoardScope,
  name: string,
  kind: "region" | "community",
): Promise<ShareCard> {
  const board = await cachedBoard({
    scope,
    period: CARD_PERIOD,
    metric: CARD_METRIC,
    limit: CARD_BOARD_ROWS,
    // Places gained do not fit on a card, so the previous Season is not worth a query.
    comparePrevious: false,
  });

  return boardCard({
    name,
    kind,
    period: CARD_PERIOD,
    metric: CARD_METRIC,
    rows: board.rows.map((row) => ({
      rank: row.rank,
      handle: row.handle,
      value: formatMetric(row.value, CARD_METRIC),
    })),
    total: board.total > 0 ? formatMetric(board.total, CARD_METRIC) : undefined,
  });
}
