/*
  Reading a Builder's Credits for their own pages. The ledger is private: it
  says what someone holds and how they got it, which is nobody else's business.
*/
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { creditLedger } from "@/db/schema";

/** How many ledger rows /settings shows. Enough to recognise, short enough to read. */
export const LEDGER_PAGE_SIZE = 20;

export interface CreditEntry {
  id: string;
  delta: number;
  reason: (typeof creditLedger.$inferSelect)["reason"];
  refId: string | null;
  createdAt: Date;
  /** The Market a buy or sell traded, from its trade row. Settlements carry theirs in the ref. */
  tradeMarketId: string | null;
}

export async function recentCreditEntries(
  builderId: string,
  limit = LEDGER_PAGE_SIZE,
): Promise<CreditEntry[]> {
  return db
    .select({
      id: creditLedger.id,
      delta: creditLedger.delta,
      reason: creditLedger.reason,
      refId: creditLedger.refId,
      createdAt: creditLedger.createdAt,
      // Literal table name: an interpolated column renders unqualified in a projection.
      tradeMarketId: sql<string | null>`(
        select t.market_id from trades t
        where t.id = case
          when credit_ledger.reason in ('buy', 'sell') then credit_ledger.ref_id::uuid
        end
      )`,
    })
    .from(creditLedger)
    .where(eq(creditLedger.builderId, builderId))
    .orderBy(desc(creditLedger.createdAt), desc(creditLedger.id))
    .limit(limit);
}
