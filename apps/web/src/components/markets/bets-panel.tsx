/*
  A Builder's bets on their profile. The record line (settled bets won and the
  realised net) is public, the same fact the Credits Won board already ranks.
  The bets themselves, what is held and on what, are the owner's business, as
  they are on the Market page, so only the owner sees the list.
*/
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { betRecord, type BetState } from "@/lib/bets";
import { formatCredits, formatDelta } from "@/lib/credits";
import type { BetRow } from "@/lib/market-queries";
import { formatClosesIn } from "@/lib/markets";

/** How many bets the owner's list shows; the record above it counts every row it is given. */
const LIST_LIMIT = 30;

const STATE_WORDS: Record<BetState, string> = {
  open: "open",
  settling: "settling",
  won: "won",
  lost: "lost",
  even: "even",
  refunded: "refunded",
};

export function BetsPanel({
  bets,
  isOwner,
  handle,
  now = new Date(),
}: {
  bets: readonly BetRow[];
  isOwner: boolean;
  handle: string;
  now?: Date;
}) {
  const record = betRecord(bets);

  return (
    <div className="min-w-0 rounded-(--radius-panel) border border-border bg-surface p-6 sm:p-8">
      <h2 className="type-label">bets</h2>

      {bets.length === 0 || (!isOwner && record.settled === 0) ? (
        <p className="mt-4 max-w-[42ch] text-[0.95rem] text-muted">
          {isOwner ? (
            <>
              No bets yet.{" "}
              <Link href="/markets" className="underline decoration-border-strong hover:text-foreground">
                Pick a market
              </Link>{" "}
              and back the builder or model you think burns most.
            </>
          ) : (
            `${handle} has no settled bets yet.`
          )}
        </p>
      ) : (
        <>
          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
            <div>
              <dt className="type-label text-[0.62rem] text-subtle">won</dt>
              <dd className="type-data mt-1 text-[1.25rem] tabular-nums">
                {record.won}
                <span className="text-[0.8rem] text-subtle">/{record.settled}</span>
              </dd>
            </div>
            <div>
              <dt className="type-label text-[0.62rem] text-subtle">lost</dt>
              <dd className="type-data mt-1 text-[1.25rem] tabular-nums">{record.lost}</dd>
            </div>
            <div>
              <dt className="type-label text-[0.62rem] text-subtle">net</dt>
              <dd
                className={`type-data mt-1 text-[1.25rem] tabular-nums ${
                  record.net > 0 ? "text-[color:var(--won)]" : ""
                }`}
              >
                {record.settled > 0 ? formatDelta(record.net) : "-"}
              </dd>
            </div>
          </dl>

          {isOwner ? (
            <ol className="mt-6 divide-y divide-border-faint border-t border-border-faint">
              {bets.slice(0, LIST_LIMIT).map((bet) => (
                <li key={bet.marketId} className="py-3">
                  <Link
                    href={`/m/${bet.marketId}`}
                    className="text-[0.9rem] leading-snug hover:text-primary-text"
                  >
                    {bet.question}
                  </Link>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Badge tone={bet.state === "won" ? "won" : "neutral"}>
                      {STATE_WORDS[bet.state]}
                    </Badge>
                    <BetLine bet={bet} now={now} />
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
        </>
      )}
    </div>
  );
}

function BetLine({ bet, now }: { bet: BetRow; now: Date }) {
  const quiet = "type-data text-[0.78rem] text-muted tabular-nums";
  if (bet.net !== null) {
    return (
      <span className={quiet}>
        staked {formatCredits(bet.bought)} ·{" "}
        <span className={bet.net > 0 ? "text-[color:var(--won)]" : "text-foreground"}>
          net {formatDelta(bet.net)}
        </span>
      </span>
    );
  }
  // Still riding: the biggest holding is what a win would pay.
  const top = bet.holdings.reduce<BetRow["holdings"][number] | null>(
    (best, holding) => (best === null || holding.shares > best.shares ? holding : best),
    null,
  );
  return (
    <span className={quiet}>
      {top ? (
        <>
          pays <span className="text-[color:var(--won)]">{formatCredits(top.shares)}</span> if{" "}
          {top.label} wins
        </>
      ) : (
        `staked ${formatCredits(bet.bought)}`
      )}
      {bet.state === "open" ? ` · ${formatClosesIn(bet.closesAt, now)}` : ""}
    </span>
  );
}
