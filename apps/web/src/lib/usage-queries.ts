/*
  Reading a Builder's Usage for their profile.

  Quarantined rows are the reason this takes a viewer argument. They stay in the
  database and stay visible to the Builder who uploaded them, because a person
  whose day was held back deserves to see it and why. Everyone else sees the
  profile without them.
*/
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db } from "@/db";
import { builderDays, usageDays } from "@/db/schema";
import { periodRange } from "./leaderboard";
import { dayRange, summarizeUsage, type UsageSummary } from "./usage";

/** How far back a profile looks. One month reads as a habit, not a lifetime. */
export const PROFILE_WINDOW_DAYS = 30;

export interface UsageQueryOptions {
  /** True only for the Builder themselves, and later for an admin. */
  includeQuarantined?: boolean;
  days?: number;
  now?: Date;
}

export async function builderUsage(
  builderId: string,
  options: UsageQueryOptions = {},
): Promise<UsageSummary> {
  const days = dayRange(options.now ?? new Date(), options.days ?? PROFILE_WINDOW_DAYS);
  const start = days[0]!;

  const rows = await db
    .select({
      day: usageDays.day,
      provider: usageDays.provider,
      model: usageDays.model,
      costUsd: usageDays.costUsd,
      inputTokens: usageDays.inputTokens,
      cachedInputTokens: usageDays.cachedInputTokens,
      cacheWriteTokens: usageDays.cacheWriteTokens,
      outputTokens: usageDays.outputTokens,
      reasoningTokens: usageDays.reasoningTokens,
      trustLevel: usageDays.trustLevel,
    })
    .from(usageDays)
    .where(
      and(
        eq(usageDays.builderId, builderId),
        gte(usageDays.day, start),
        // A duplicate is another Device's copy of the same work, so it is not shown twice.
        isNull(usageDays.duplicateOfDeviceId),
        options.includeQuarantined ? undefined : sql`${usageDays.trustLevel} <> 'quarantined'`,
      ),
    );

  return summarizeUsage(rows, days);
}

/** A Builder's burn over the two Seasons a share card and a title quote. */
export interface BurnSeasons {
  weekCostUsd: number;
  monthCostUsd: number;
  /** Weakest Trust Level over the counted days this month, which is what a badge would say. */
  trust: "verified" | "reported";
}

/*
  Read off `builder_days`, the same rollup Leaderboards use, so a profile card and
  a board can never quote two different numbers for the same week. Quarantined
  days are excluded here as they are there (ADR 0003).

  Public, viewer independent and therefore cached: the card and the page title
  both want it, and neither is worth a second query.
*/
export const cachedBurnSeasons = unstable_cache(
  async (builderId: string): Promise<BurnSeasons> => {
    const now = new Date();
    const week = periodRange("week", now);
    const month = periodRange("month", now);

    const [row] = await db
      .select({
        week: sql<number>`coalesce(sum(${builderDays.costUsd}) filter (
          where ${builderDays.day} >= ${week.start} and ${builderDays.day} <= ${week.end}
        ), 0)::double precision`,
        month: sql<number>`coalesce(sum(${builderDays.costUsd}) filter (
          where ${builderDays.day} >= ${month.start} and ${builderDays.day} <= ${month.end}
        ), 0)::double precision`,
        reported: sql<boolean>`coalesce(bool_or(${builderDays.trustLevelMin} = 'reported') filter (
          where ${builderDays.day} >= ${month.start} and ${builderDays.day} <= ${month.end}
        ), true)`,
      })
      .from(builderDays)
      .where(
        and(eq(builderDays.builderId, builderId), sql`${builderDays.trustLevelMin} <> 'quarantined'`),
      );

    return {
      weekCostUsd: Number(row?.week ?? 0),
      monthCostUsd: Number(row?.month ?? 0),
      trust: row?.reported === false ? "verified" : "reported",
    };
  },
  ["builder-burn-seasons"],
  { revalidate: 300, tags: ["leaderboard"] },
);
