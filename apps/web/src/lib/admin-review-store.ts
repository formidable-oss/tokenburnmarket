/*
  The Drizzle half of the quarantine review. Statements only, no decisions.

  The two effects of clearing a row are borrowed rather than rewritten: the
  rollup is `rollupBuilderDays` over the Sync store, and the mint is
  `remintBuilderDay` over the mint store. A review therefore lands on exactly the
  numbers a Sync and the nightly cron would have produced, which is the point.
*/
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { quarantineReviews, usageDays } from "@/db/schema";
import type { AdminReviewStore, UsageKey } from "./admin-review";
import { remintBuilderDay } from "./mint";
import { drizzleMintStore } from "./mint-store";
import { rollupBuilderDays } from "./sync";
import { drizzleSyncStore } from "./sync-store";

function keyMatches(key: UsageKey) {
  return and(
    eq(usageDays.deviceId, key.deviceId),
    eq(usageDays.day, key.day),
    eq(usageDays.provider, key.provider),
    eq(usageDays.model, key.model),
  );
}

export const drizzleAdminReviewStore: AdminReviewStore = {
  async usageRow(key) {
    const [row] = await db
      .select({ builderId: usageDays.builderId, trustLevel: usageDays.trustLevel })
      .from(usageDays)
      .where(keyMatches(key))
      .limit(1);
    return row ?? null;
  },

  async recordReview(review) {
    await db.insert(quarantineReviews).values({
      deviceId: review.deviceId,
      day: review.day,
      provider: review.provider,
      model: review.model,
      decision: review.decision,
      note: review.note,
      reviewerId: review.reviewerId,
    });
  },

  async setTrustLevel(key, trustLevel) {
    await db
      .update(usageDays)
      .set({ trustLevel, checkedAt: new Date() })
      .where(keyMatches(key));
  },

  async recomputeBuilderDay(builderId, day) {
    const rows = await drizzleSyncStore.usageRowsForDays(builderId, [day]);
    await drizzleSyncStore.putBuilderDays(rollupBuilderDays(builderId, [day], rows));
  },

  async remintBuilderDay(builderId, day) {
    return remintBuilderDay(drizzleMintStore, builderId, day, new Date());
  },
};
