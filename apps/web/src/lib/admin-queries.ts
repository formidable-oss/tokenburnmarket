/*
  The two reads behind /admin: the queue of Quarantined Usage, and the Markets
  that speak for the whole site.

  Nothing here is cached. An Admin acting on a page that is five minutes old
  would be reviewing rows someone else already cleared, and the queue is a
  handful of rows on a good day.
*/
import { and, asc, desc, eq, or, sql, type SQLWrapper } from "drizzle-orm";
import { db } from "@/db";
import {
  builders,
  devices,
  markets,
  quarantineReviews,
  usageDays,
  type UsageReason,
} from "@/db/schema";
import type { ReviewDecision } from "./admin-review";

/** How many Quarantined rows one page of the queue holds. */
export const QUEUE_LIMIT = 200;

export interface QuarantineRow {
  deviceId: string;
  deviceName: string;
  day: string;
  provider: string;
  model: string;
  tokens: number;
  costUsd: number;
  reasons: UsageReason[];
  /** The last decision recorded against this row, when someone has looked before. */
  lastDecision: ReviewDecision | null;
  lastNote: string | null;
}

/** One Builder's Quarantined Usage for one day: the unit an Admin actually judges. */
export interface QuarantineGroup {
  builderId: string;
  handle: string;
  day: string;
  tokens: number;
  costUsd: number;
  rows: QuarantineRow[];
}

/*
  Quarantined Usage, newest day first. Grouping happens here rather than in SQL
  because the reasons are per row and the point of the page is to read them
  together: one Builder, one day, every row that failed and why.
*/
export async function quarantineQueue(limit = QUEUE_LIMIT): Promise<QuarantineGroup[]> {
  const tokens = sql<number>`(
    ${usageDays.inputTokens} + ${usageDays.cachedInputTokens} + ${usageDays.cacheWriteTokens}
    + ${usageDays.outputTokens} + ${usageDays.reasoningTokens}
  )::double precision`;

  /*
    The newest review of this row, if any: what an earlier Admin decided and why.
    A correlated subquery rather than a join, because a row reviewed three times
    must still be one row in the queue.
  */
  const lastReview = <T>(column: SQLWrapper) => sql<T>`(
    select ${column} from ${quarantineReviews}
    where ${quarantineReviews.deviceId} = ${usageDays.deviceId}
      and ${quarantineReviews.day} = ${usageDays.day}
      and ${quarantineReviews.provider} = ${usageDays.provider}
      and ${quarantineReviews.model} = ${usageDays.model}
    order by ${quarantineReviews.createdAt} desc
    limit 1
  )`;

  const rows = await db
    .select({
      builderId: usageDays.builderId,
      handle: builders.handle,
      deviceId: usageDays.deviceId,
      deviceName: devices.name,
      day: usageDays.day,
      provider: usageDays.provider,
      model: usageDays.model,
      tokens,
      costUsd: usageDays.costUsd,
      reasons: usageDays.quarantineReasons,
      lastDecision: lastReview<ReviewDecision | null>(quarantineReviews.decision),
      lastNote: lastReview<string | null>(quarantineReviews.note),
    })
    .from(usageDays)
    .innerJoin(builders, eq(builders.id, usageDays.builderId))
    .innerJoin(devices, eq(devices.id, usageDays.deviceId))
    .where(eq(usageDays.trustLevel, "quarantined"))
    .orderBy(desc(usageDays.day), asc(builders.handle), asc(usageDays.provider))
    .limit(limit);

  const groups = new Map<string, QuarantineGroup>();
  for (const row of rows) {
    const key = `${row.builderId}|${row.day}`;
    const group = groups.get(key) ?? {
      builderId: row.builderId,
      handle: row.handle,
      day: row.day,
      tokens: 0,
      costUsd: 0,
      rows: [],
    };
    group.tokens += Number(row.tokens);
    group.costUsd += row.costUsd;
    group.rows.push({
      deviceId: row.deviceId,
      deviceName: row.deviceName,
      day: row.day,
      provider: row.provider,
      model: row.model,
      tokens: Number(row.tokens),
      costUsd: row.costUsd,
      reasons: row.reasons,
      lastDecision: row.lastDecision,
      lastNote: row.lastNote,
    });
    groups.set(key, group);
  }
  return [...groups.values()];
}

export interface SiteMarketRow {
  id: string;
  question: string;
  scope: "global" | "country";
  country: string | null;
  closesAt: Date;
  resolvesAt: Date;
}

/** The open Markets nobody owns: global and country. The ones only an Admin opens. */
export async function openSiteMarkets(): Promise<SiteMarketRow[]> {
  const rows = await db
    .select({
      id: markets.id,
      question: markets.question,
      scope: markets.scope,
      country: markets.country,
      closesAt: markets.closesAt,
      resolvesAt: markets.resolvesAt,
    })
    .from(markets)
    .where(
      and(
        eq(markets.status, "open"),
        or(eq(markets.scope, "global"), eq(markets.scope, "country")),
      ),
    )
    .orderBy(asc(markets.closesAt))
    .limit(50);

  return rows.filter(
    (row): row is SiteMarketRow => row.scope === "global" || row.scope === "country",
  );
}
