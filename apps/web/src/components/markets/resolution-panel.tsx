/*
  How a Market ended, or that it is about to, on the Market page. Four states
  worth a panel: settled on an outcome, voided with the reason, waiting on a
  quarantine review, or closed and waiting for the nightly run. A Market still
  taking trades gets nothing here: the header already says when it closes.

  The viewer's own line is the point of the panel. What everyone can see is the
  winner; what only they can see is what they staked, what it paid and the net,
  with a word for the result so the color never has to carry it.
*/
import { Badge } from "@/components/ui/badge";
import type { BetState } from "@/lib/bets";
import { formatCredits, formatDelta } from "@/lib/credits";
import type { BetRow } from "@/lib/market-queries";
import { formatResolvesAt, type MarketStatus } from "@/lib/markets";

const RESULT_WORDS: Partial<Record<BetState, string>> = {
  won: "you won",
  lost: "you lost",
  even: "even",
  refunded: "refunded",
};

export function ResolutionPanel({
  status,
  closesAt,
  resolvesAt,
  winnerLabel,
  note,
  holdUntil,
  bet,
  now = new Date(),
}: {
  status: MarketStatus;
  closesAt: Date;
  resolvesAt: Date;
  /** The Outcome that won, when there is one. */
  winnerLabel: string | null;
  /** Why the Market is held or voided, in the resolver's words. */
  note: string | null;
  holdUntil: Date | null;
  /** The viewer's bet on this Market, or null for a signed-out or untraded viewer. */
  bet: BetRow | null;
  now?: Date;
}) {
  const held = status === "closed" && holdUntil !== null && holdUntil.getTime() > now.getTime();
  const settling =
    !held && (status === "closed" || (status === "open" && closesAt.getTime() <= now.getTime()));
  if (status !== "resolved" && status !== "voided" && !held && !settling) return null;

  const result = bet ? RESULT_WORDS[bet.state] : undefined;
  const due = resolvesAt.getTime() <= now.getTime();

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
          {note ?? "This market could not be settled from usage."} Every position still held was
          refunded at what it cost.
        </p>
      ) : null}

      {held && holdUntil ? (
        <p className="mt-3 max-w-[62ch] text-[0.95rem] text-muted">
          {note ?? "The usage behind this market is under review."} Settling waits until{" "}
          {formatResolvesAt(holdUntil)}. If the review has not cleared by then, the market voids and
          every position is refunded at cost.
        </p>
      ) : null}

      {settling ? (
        <p className="mt-3 max-w-[62ch] text-[0.95rem] text-muted">
          {due
            ? "Trading is closed and the result is due. The nightly run just after 00:00 UTC reads the usage and pays every winning share 1 credit."
            : `Trading is closed. Late syncs still count until ${formatResolvesAt(resolvesAt)}, then the nightly run pays every winning share 1 credit.`}
        </p>
      ) : null}

      {bet && result && bet.net !== null ? (
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border-faint pt-4 sm:grid-cols-4">
          <div>
            <dt className="type-label text-[0.7rem] text-subtle">result</dt>
            <dd className="mt-1">
              <Badge tone={bet.state === "won" ? "won" : "neutral"}>{result}</Badge>
            </dd>
          </div>
          <Figure term="staked" value={formatCredits(bet.bought)} />
          {/* Payout or refund plus anything raised by selling: all that came back. */}
          <Figure term="returned" value={formatCredits(bet.paid + bet.sold)} />
          <Figure term="net" value={formatDelta(bet.net)} won={bet.net > 0} />
        </dl>
      ) : null}

      {bet && (settling || held) && bet.holdings.length > 0 ? (
        <p className="type-data mt-4 border-t border-border-faint pt-4 text-[0.85rem] tabular-nums">
          {bet.holdings.map((holding, index) => (
            <span key={holding.outcomeId} className="block">
              {index === 0 ? "pays " : "or "}
              <span className="text-[color:var(--won)]">{formatCredits(holding.shares)} cr</span>{" "}
              <span className="text-muted">if {holding.label} wins</span>
            </span>
          ))}
        </p>
      ) : null}
    </section>
  );
}

function Figure({ term, value, won }: { term: string; value: string; won?: boolean }) {
  return (
    <div>
      <dt className="type-label text-[0.7rem] text-subtle">{term}</dt>
      <dd
        className={`type-data mt-1 text-[1.05rem] tabular-nums ${won ? "text-[color:var(--won)]" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
