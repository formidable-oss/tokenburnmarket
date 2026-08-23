/*
  The Drizzle half of automatic market creation. Statements only, no decisions.

  The one worth reading twice is `create`: it writes the Market and its Outcomes
  in a single batch, which Neon runs as one transaction, so a Market never
  exists without a book, and the unique `auto_key` is what makes a second run of
  the same period insert nothing.
*/
import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { builders, markets, outcomes } from "@/db/schema";
import { parseAdminHandles } from "./admin";
import type { AutoCommunity, AutoMarketStore } from "./auto-markets";
import { builderCount, communitiesForMarkets, modelsInPlay } from "./market-queries";
import type { MarketPlan } from "./market-templates";

export function drizzleAutoMarketStore(now: Date = new Date()): AutoMarketStore {
  return {
    async communities(): Promise<AutoCommunity[]> {
      return communitiesForMarkets({ now });
    },

    async topModels(limit): Promise<string[]> {
      return modelsInPlay(limit, null, now);
    },

    builderCount,

    async adminBuilderId(): Promise<string | null> {
      const handles = [...parseAdminHandles(process.env.ADMIN_HANDLES)];
      if (handles.length === 0) return null;
      const [row] = await db
        .select({ id: builders.id })
        .from(builders)
        .where(inArray(sql`lower(${builders.handle})`, handles))
        .orderBy(asc(builders.createdAt))
        .limit(1);
      return row?.id ?? null;
    },

    async create(plan: MarketPlan, createdBy: string): Promise<boolean> {
      if (!plan.autoKey) throw new Error("an auto-created market needs an auto key");

      // The unique key is the real guard; this read just keeps the common re-run cheap.
      const [existing] = await db
        .select({ id: markets.id })
        .from(markets)
        .where(eq(markets.autoKey, plan.autoKey))
        .limit(1);
      if (existing) return false;

      const id = crypto.randomUUID();
      try {
        await db.batch([
          db.insert(markets).values({
            id,
            scope: plan.scope,
            communityId: plan.communityId,
            country: plan.country,
            type: plan.type,
            question: plan.question,
            params: plan.params,
            b: plan.b,
            closesAt: plan.closesAt,
            resolvesAt: plan.resolvesAt,
            autoKey: plan.autoKey,
            createdBy,
          }),
          ...plan.outcomes.map((outcome) =>
            db.insert(outcomes).values({
              marketId: id,
              label: outcome.label,
              ref: outcome.ref,
              sort: outcome.sort,
            }),
          ),
        ]);
        return true;
      } catch (error) {
        // Two runs overlapping: the unique `auto_key` rejected the second one.
        if (String(error).includes("markets_auto_key_unique")) return false;
        throw error;
      }
    },
  };
}
