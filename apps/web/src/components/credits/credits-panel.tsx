/*
  Credits on /settings: the balance, then the rows that add up to it. The ledger
  is the honest version of a balance, so it is a table and not a summary.
*/
import Link from "next/link";
import {
  creditEntryDay,
  creditEntryMarketId,
  creditReasonLabel,
  formatCredits,
  formatDelta,
} from "@/lib/credits";
import type { CreditEntry } from "@/lib/credit-queries";

const stamp = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  dateStyle: "medium",
  timeStyle: "short",
});

export function CreditsPanel({
  balance,
  entries,
}: {
  balance: number;
  entries: readonly CreditEntry[];
}) {
  return (
    <section className="rounded-(--radius-panel) border border-border bg-surface p-6 sm:p-8">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h2 className="type-label">credits</h2>
        <p className="type-data ml-auto text-[1.6rem] leading-none text-primary tabular-nums">
          {formatCredits(balance)}
        </p>
      </div>

      <p className="mt-4 max-w-[52ch] text-[0.95rem] text-muted">
        Credits are minted from your usage the day after it closes, on a curve that flattens above
        20 dollars. Reported days mint at half. They buy positions, and a settled market pays them
        back one credit per winning share.
      </p>

      {entries.length === 0 ? (
        <p className="mt-6 text-[0.95rem] text-muted">
          No entries yet. The first mint lands a day after your first synced day closes.
        </p>
      ) : (
        <table className="mt-6 w-full border-collapse text-[0.85rem]">
          <thead>
            <tr className="type-label text-subtle">
              <th className="py-1 text-left font-normal">when</th>
              <th className="py-1 text-left font-normal">reason</th>
              <th className="py-1 text-right font-normal">credits</th>
            </tr>
          </thead>
          <tbody className="type-data">
            {entries.map((entry) => {
              const day = creditEntryDay(entry.reason, entry.refId);
              const marketId = creditEntryMarketId(entry.reason, entry.refId);
              return (
                <tr key={entry.id} className="border-t border-border-faint">
                  <td className="py-1.5 pr-3 text-muted tabular-nums">
                    {stamp.format(entry.createdAt)}
                  </td>
                  <td className="py-1.5 pr-3">
                    {marketId ? (
                      <Link href={`/m/${marketId}`} className="hover:text-primary-text">
                        {creditReasonLabel(entry.reason)}
                      </Link>
                    ) : (
                      creditReasonLabel(entry.reason)
                    )}
                    {day ? <span className="ml-2 text-subtle tabular-nums">{day}</span> : null}
                  </td>
                  <td className="py-1.5 pl-3 text-right tabular-nums">{formatDelta(entry.delta)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
