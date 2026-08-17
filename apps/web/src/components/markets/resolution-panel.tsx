/*
  How a Market ended, on the Market page. Three states worth a panel: settled on
  an outcome, voided with the reason, or waiting on a quarantine review. A
  market still open, or closed and simply not due yet, gets nothing here: the
  header already says when it settles.

  The viewer's own line is the point of the panel. What everyone can see is the
  winner; what only they can see is what it paid them.
*/
import { Badge } from "@/components/ui/badge";
import { formatCredits } from "@/lib/credits";
import type { ViewerSettlement } from "@/lib/market-queries";
import { formatResolvesAt, type MarketStatus } from "@/lib/markets";

export function ResolutionPanel({
  status,
  winnerLabel,
  note,
  holdUntil,
  settlement,
  now = new Date(),
}: {
  status: MarketStatus;
  /** The Outcome that won, when there is one. */
  winnerLabel: string | null;
  /** Why the Market is held or voided, in the resolver's words. */
  note: string | null;
  holdUntil: Date | null;
  /** What settling paid the viewer, or null for a signed-out or untraded viewer. */
  settlement: ViewerSettlement | null;
  now?: Date;
}) {
  const held = status === "closed" && holdUntil !== null && holdUntil.getTime() > now.getTime();
  if (status !== "resolved" && status !== "voided" && !held) return null;

  return (
    <section className="rounded-(--radius-panel) border border-border bg-surface px-5 py-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="type-label">
          {status === "resolved" ? "settled" : status === "voided" ? "voided" : "settling"}
        </h2>
        {status === "resolved" && winnerLabel ? (
          <>
            <Badge tone="won">won</Badge>
            <span className="text-[0.95rem]">{winnerLabel}</span>
          </>
        ) : null}
      </div>

      {status === "resolved" ? (
        <p className="mt-3 max-w-[62ch] text-[0.95rem] text-muted">
          Usage over the period settled this. Every winning share paid 1 credit.
        </p>
      ) : null}

      {status === "voided" ? (
        <p className="mt-3 max-w-[62ch] text-[0.95rem] text-muted">
          {note ?? "This market could not be settled from usage."} Every position was refunded at
          what it cost.
        </p>
      ) : null}

      {held && holdUntil ? (
        <p className="mt-3 max-w-[62ch] text-[0.95rem] text-muted">
          {note ?? "The usage behind this market is under review."} Settling waits until{" "}
          {formatResolvesAt(holdUntil)}. If the review has not cleared by then, the market voids and
          every position is refunded at cost.
        </p>
      ) : null}

      {settlement ? (
        <p className="type-data mt-4 text-[0.9rem] tabular-nums">
          {settlement.reason === "payout" ? "your payout" : "your refund"}{" "}
          <span className="text-primary">+{formatCredits(settlement.credits)}</span> credits
        </p>
      ) : null}
    </section>
  );
}
