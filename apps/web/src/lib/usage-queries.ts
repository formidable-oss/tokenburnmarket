/*
  Reading a Builder's Usage for their profile.

  Quarantined rows are the reason this takes a viewer argument. They stay in the
  database and stay visible to the Builder who uploaded them, because a person
  whose day was held back deserves to see it and why. Everyone else sees the
  profile without them.
*/
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { usageDays } from "@/db/schema";
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
