/*
  The Drizzle half of settling Markets. Statements only, no decisions:
  lib/resolution.ts owns those.

  Paying out is one interactive transaction, so it uses `dbTx`. The transaction
  opens by locking the Market row and re-reading its status, which is what stops
  two overlapping cron runs from settling the same Market twice; the unique
  (builder, reason, ref) index on the ledger is the second guarantee behind it,
  so even a torn run can only ever write one payout row per Builder per Market.
*/
import { parseTemplateParams, type ResolutionSnapshot } from "@tokenburnmarket/core";
import { and, asc, eq, gte, inArray, isNull, lte, lt, or, sql } from "drizzle-orm";
import { db, dbTx } from "@/db";
import {
  builderDays,
  builders,
  creditLedger,
  markets,
  memberships,
  outcomes,
  positions,
  usageDays,
} from "@/db/schema";
import {
  marketRef,
  planPayouts,
  planRefunds,
  type CreditWrite,
  type ResolutionStore,
  type ResolvableMarket,
  type SettlementPosition,
  type SettlementResult,
} from "./resolution";

/** `builders.credit_balance` as the ledger says it should be, never incremented blindly. */
const balanceFromLedger = sql`coalesce((
  select sum(${creditLedger.delta})
  from ${creditLedger}
  where ${creditLedger.builderId} = ${builders.id}
), 0)`;

/*
  Quarantined Usage is excluded from the totals and remembered as a flag, so the
  resolver can tell "burned nothing" apart from "we are not sure yet".
*/
const countedCost = sql<number>`coalesce(sum(
  case when ${builderDays.trustLevelMin} <> 'quarantined' then ${builderDays.costUsd} else 0 end
), 0)::double precision`;

const countedTokens = sql<number>`coalesce(sum(
  case when ${builderDays.trustLevelMin} <> 'quarantined' then ${builderDays.totalTokens} else 0 end
), 0)::double precision`;

const anyQuarantined = sql<boolean>`bool_or(${builderDays.trustLevelMin} = 'quarantined')`;

type TemplateParams = NonNullable<ReturnType<typeof parseTemplateParams>>;

/** The Builders a Market compares: its Community, its Region, or everyone. */
function scopeCondition(scope: TemplateParams["scope"]) {
  if (scope.kind === "community") {
    return sql`exists (
      select 1 from ${memberships}
      where ${memberships.communityId} = ${scope.communityId}
        and ${memberships.builderId} = ${builders.id}
    )`;
  }
  if (scope.kind === "country") return eq(builders.country, scope.country);
  return undefined;
}

/**
 * Which Builders the snapshot has to carry. Threshold and Head-to-Head name
 * theirs, so the snapshot is exactly those two rows and a quarantine elsewhere
 * in the Community never holds them up.
 */
function namedBuilders(params: TemplateParams): string[] | null {
  if (params.template === "threshold") return [params.threshold.builderId];
  if (params.template === "head_to_head") return params.pair.map((builder) => builder.builderId);
  return null;
}

async function builderSnapshot(params: TemplateParams): Promise<ResolutionSnapshot["builders"]> {
  const named = namedBuilders(params);
  const rows = await db
    .select({
      builderId: builders.id,
      handle: builders.handle,
      costUsd: countedCost,
      totalTokens: countedTokens,
      quarantined: anyQuarantined,
    })
    .from(builderDays)
    .innerJoin(builders, eq(builders.id, builderDays.builderId))
    .where(
      and(
        gte(builderDays.day, params.period.start),
        lte(builderDays.day, params.period.end),
        named ? inArray(builders.id, named) : scopeCondition(params.scope),
      ),
    )
    .groupBy(builders.id, builders.handle);

  return rows.map((row) => ({
    builderId: row.builderId,
    handle: row.handle,
    costUsd: Number(row.costUsd),
    totalTokens: Number(row.totalTokens),
    quarantined: Boolean(row.quarantined),
  }));
}

/*
  Tokens per model over the period, in scope. Quarantined rows are left out here
  as they are everywhere else, and a Device's duplicate copy of another Device's
  transcripts is counted once.
*/
async function modelSnapshot(params: TemplateParams): Promise<ResolutionSnapshot["models"]> {
  const tokens = sql<number>`coalesce(sum(
    ${usageDays.inputTokens} + ${usageDays.cachedInputTokens} + ${usageDays.cacheWriteTokens}
    + ${usageDays.outputTokens} + ${usageDays.reasoningTokens}
  ), 0)::double precision`;

  const rows = await db
    .select({ model: usageDays.model, totalTokens: tokens })
    .from(usageDays)
    .innerJoin(builders, eq(builders.id, usageDays.builderId))
    .where(
      and(
        gte(usageDays.day, params.period.start),
        lte(usageDays.day, params.period.end),
        sql`${usageDays.trustLevel} <> 'quarantined'`,
        isNull(usageDays.duplicateOfDeviceId),
        scopeCondition(params.scope),
      ),
    )
    .groupBy(usageDays.model);

  return rows.map((row) => ({ model: row.model, totalTokens: Number(row.totalTokens) }));
}

/** Inserts one settlement's ledger rows and rewrites the balances they moved. */
async function writeCredits(
  tx: Parameters<Parameters<typeof dbTx.transaction>[0]>[0],
  marketId: string,
  reason: "payout" | "refund",
  writes: readonly CreditWrite[],
  now: Date,
): Promise<SettlementResult> {
  if (writes.length === 0) return { builders: 0, credits: 0 };

  const inserted = await tx
    .insert(creditLedger)
    .values(
      writes.map((write) => ({
        builderId: write.builderId,
        delta: write.credits,
        reason,
        refId: marketRef(marketId),
        createdAt: now,
      })),
    )
    .onConflictDoNothing()
    .returning({ builderId: creditLedger.builderId, delta: creditLedger.delta });

  /*
    Balances are rewritten for everyone touched, not only for the rows this call
    inserted: that is the repair path for a run that died between the ledger and
    the balance.
  */
  await tx
    .update(builders)
    .set({ creditBalance: balanceFromLedger })
    .where(
      inArray(
        builders.id,
        writes.map((write) => write.builderId),
      ),
    );

  return {
    builders: inserted.length,
    credits: inserted.reduce((total, row) => total + Number(row.delta), 0),
  };
}

/** Every Position on a Market, whatever it is worth. */
async function positionsOf(
  tx: Parameters<Parameters<typeof dbTx.transaction>[0]>[0],
  marketId: string,
): Promise<SettlementPosition[]> {
  return tx
    .select({
      builderId: positions.builderId,
      outcomeId: positions.outcomeId,
      shares: positions.shares,
      costBasis: positions.costBasis,
    })
    .from(positions)
    .where(eq(positions.marketId, marketId));
}

const NOTHING: SettlementResult = { builders: 0, credits: 0 };

export const drizzleResolutionStore: ResolutionStore = {
  async closeExpired(now): Promise<number> {
    const closed = await db
      .update(markets)
      .set({ status: "closed" })
      .where(and(eq(markets.status, "open"), lte(markets.closesAt, now)))
      .returning({ id: markets.id });
    return closed.length;
  },

  async dueForResolution(now): Promise<ResolvableMarket[]> {
    const rows = await db
      .select({
        id: markets.id,
        params: markets.params,
        holdUntil: markets.holdUntil,
      })
      .from(markets)
      .where(
        and(
          eq(markets.status, "closed"),
          lte(markets.resolvesAt, now),
          // A held Market is left alone until its wait is over.
          or(isNull(markets.holdUntil), lt(markets.holdUntil, now)),
        ),
      )
      .orderBy(asc(markets.resolvesAt));
    if (rows.length === 0) return [];

    const book = await db
      .select({ marketId: outcomes.marketId, id: outcomes.id, ref: outcomes.ref })
      .from(outcomes)
      .where(
        inArray(
          outcomes.marketId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(outcomes.sort));

    return rows.map((row) => ({
      ...row,
      outcomes: book.filter((outcome) => outcome.marketId === row.id),
    }));
  },

  async snapshotFor(market): Promise<ResolutionSnapshot> {
    const params = parseTemplateParams(market.params);
    // Only a template can be settled; the caller skips the rest on the same test.
    if (!params) return { builders: [], models: [] };

    const [buildersInScope, models] = await Promise.all([
      builderSnapshot(params),
      params.template === "model_race" ? modelSnapshot(params) : Promise.resolve([]),
    ]);
    return { builders: buildersInScope, models };
  },

  async payout(marketId, winningOutcomeId, now): Promise<SettlementResult> {
    return dbTx.transaction(async (tx) => {
      const [market] = await tx
        .select({ status: markets.status })
        .from(markets)
        .where(eq(markets.id, marketId))
        .for("update");
      // Another run got here first, and its writes are the settled ones.
      if (!market || market.status !== "closed") return NOTHING;

      const result = await writeCredits(
        tx,
        marketId,
        "payout",
        planPayouts(await positionsOf(tx, marketId), winningOutcomeId),
        now,
      );

      await tx
        .update(markets)
        .set({
          status: "resolved",
          winningOutcomeId,
          holdUntil: null,
          resolutionNote: null,
        })
        .where(eq(markets.id, marketId));

      return result;
    });
  },

  async refund(marketId, reason, now): Promise<SettlementResult> {
    return dbTx.transaction(async (tx) => {
      const [market] = await tx
        .select({ status: markets.status })
        .from(markets)
        .where(eq(markets.id, marketId))
        .for("update");
      if (!market || market.status !== "closed") return NOTHING;

      const result = await writeCredits(
        tx,
        marketId,
        "refund",
        planRefunds(await positionsOf(tx, marketId)),
        now,
      );

      await tx
        .update(markets)
        .set({ status: "voided", holdUntil: null, resolutionNote: reason })
        .where(eq(markets.id, marketId));

      return result;
    });
  },

  async hold(marketId, until, reason): Promise<void> {
    await db
      .update(markets)
      .set({ holdUntil: until, resolutionNote: reason })
      .where(and(eq(markets.id, marketId), eq(markets.status, "closed")));
  },
};
