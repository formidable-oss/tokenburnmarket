/*
  The Drizzle half of the mint. Statements only, no decisions.

  The Neon HTTP driver has no interactive transaction, so a mint is two
  statements: the ledger row, then the Builder-day it advances. The unique ref
  on the ledger makes the first statement the lock, and the second is guarded by
  the revision it expects, so a repeat of either is harmless.
*/
import { MINT_CURVE_VERSION } from "@tokenburnmarket/core";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { builderDays, builders, creditLedger } from "@/db/schema";
import { SIGNUP_REF, type MintCandidate, type MintStore, type MintWrite } from "./mint";

/**
 * `builders.credit_balance` as the ledger says it should be. Written rather
 * than incremented, so a balance can never drift away from its rows.
 */
/** The columns the mint reads off a Builder-day, shared by both candidate queries. */
const candidateColumns = {
  builderId: builderDays.builderId,
  day: builderDays.day,
  costUsd: builderDays.costUsd,
  trustLevelMin: builderDays.trustLevelMin,
  creditsMinted: builderDays.creditsMinted,
  mintRevision: builderDays.mintRevision,
};

const balanceFromLedger = sql`coalesce((
  select sum(${creditLedger.delta})
  from ${creditLedger}
  where ${creditLedger.builderId} = ${builders.id}
), 0)`;

/**
 * Which Builder-days the mint still has to look at. Exported so the shape of
 * the condition can be asserted: the `or` has to stay parenthesised, or day and
 * cost stop constraining anything at all.
 */
export function mintCandidateFilter(throughDay: string) {
  return and(
    lte(builderDays.day, throughDay),
    // A day with no cost mints nothing, ever.
    sql`${builderDays.costUsd} > 0`,
    /*
      The curve never pays more than cost + 1 Credit (the square-root tail beats
      the line by at most one Credit, at cost = 21), so a day already above that
      bound on the current curve has nothing left to give.
    */
    sql`(${builderDays.mintVersion} is distinct from ${MINT_CURVE_VERSION}
         or ${builderDays.creditsMinted} < ${builderDays.costUsd} + 1)`,
  );
}

export const drizzleMintStore: MintStore = {
  async candidates(throughDay): Promise<MintCandidate[]> {
    return db
      .select(candidateColumns)
      .from(builderDays)
      .where(mintCandidateFilter(throughDay))
      .orderBy(builderDays.day);
  },

  async candidateFor(builderId, day): Promise<MintCandidate | null> {
    const [row] = await db
      .select(candidateColumns)
      .from(builderDays)
      .where(and(eq(builderDays.builderId, builderId), eq(builderDays.day, day)))
      .limit(1);
    return row ?? null;
  },

  async recordMint(write: MintWrite) {
    const inserted = await db
      .insert(creditLedger)
      .values({
        builderId: write.builderId,
        delta: write.delta,
        reason: "mint",
        refId: write.refId,
      })
      .onConflictDoNothing()
      .returning({ id: creditLedger.id });

    // Applied even when the row was already there: that is the repair path for a
    // run that died between the two statements.
    await db
      .update(builderDays)
      .set({
        creditsMinted: write.credits,
        mintVersion: write.curveVersion,
        mintRevision: write.revision + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(builderDays.builderId, write.builderId),
          eq(builderDays.day, write.day),
          eq(builderDays.mintRevision, write.revision),
        ),
      );

    return inserted.length > 0;
  },

  async refreshBalances(builderIds) {
    if (builderIds.length === 0) return;
    await db
      .update(builders)
      .set({ creditBalance: balanceFromLedger })
      .where(inArray(builders.id, [...builderIds]));
  },

  async grantSignup(builderId, credits) {
    const inserted = await db
      .insert(creditLedger)
      .values({ builderId, delta: credits, reason: "signup", refId: SIGNUP_REF })
      .onConflictDoNothing()
      .returning({ id: creditLedger.id });
    return inserted.length > 0;
  },
};
