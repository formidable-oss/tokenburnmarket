/*
  Database schema. One file, append new tables as tickets land.
  Credits carry four decimals everywhere (CREDIT_DECIMALS in core), so every
  Credit column is numeric(14, 4); timestamps are UTC.
*/
import {
  bigint,
  boolean,
  char,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Credits as stored: four decimals, matching CREDIT_DECIMALS in core. */
const credits = (name: string) => numeric(name, { precision: 14, scale: 4, mode: "number" });

/*
  A sha256 digest, stored as `bytea` and handled as lowercase hex everywhere
  above the driver. Writes go out in Postgres text form, `\x…`; reads come back
  as either that string or raw bytes depending on the driver, so both are
  accepted and normalised to hex.
*/
const bytea = customType<{ data: string; driverData: string | Uint8Array }>({
  dataType: () => "bytea",
  toDriver: (value) => `\\x${value}`,
  fromDriver: (value) =>
    typeof value === "string"
      ? value.startsWith("\\x")
        ? value.slice(2)
        : value
      : Buffer.from(value).toString("hex"),
});

/*
  A Builder is a signed-in person. `handle` mirrors the GitHub login and is the
  public identity at /@handle. `github_id` is the stable OAuth subject, so a
  Builder survives a GitHub rename. `credit_balance` caches the ledger sum.
  `country` is an ISO 3166-1 alpha-2 code, the Builder's self-declared Region.
*/
export const builders = pgTable(
  "builders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    githubId: text("github_id").notNull().unique(),
    handle: text("handle").notNull().unique(),
    avatarUrl: text("avatar_url"),
    xHandle: text("x_handle"),
    country: char("country", { length: 2 }),
    creditBalance: credits("credit_balance").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Country and continent boards both filter on this column, so it is indexed.
  (table) => [index("builders_country_idx").on(table.country)],
);

export type Builder = typeof builders.$inferSelect;

/*
  A Community is a group of Builders with its own Leaderboards and Markets.
  `slug` is the public address at /c/:slug. The invite code is the only way in, so
  it is unique and rotated in place: replacing it invalidates every link already
  handed out, which is the whole point of rotation.
*/
export const communityVisibility = pgEnum("community_visibility", ["public", "unlisted"]);

export const communities = pgTable("communities", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  bio: text("bio"),
  visibility: communityVisibility("visibility").notNull().default("public"),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => builders.id, { onDelete: "cascade" }),
  inviteCode: text("invite_code").notNull().unique(),
  /*
    Whether a plain member may open a Market here. On by default, because a
    Community that cannot bet on itself is a leaderboard; the owner can turn it
    off when a group wants one voice setting the questions.
  */
  marketsMembersCanCreate: boolean("markets_members_can_create").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Community = typeof communities.$inferSelect;

export const membershipRole = pgEnum("membership_role", ["owner", "member"]);

/*
  Membership is the many-to-many between Builders and Communities. The pair is the
  primary key, so following an invite twice is a no-op instead of a second row.
*/
export const memberships = pgTable(
  "memberships",
  {
    communityId: uuid("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    builderId: uuid("builder_id")
      .notNull()
      .references(() => builders.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.communityId, table.builderId] })],
);

export type Membership = typeof memberships.$inferSelect;

/*
  A Device is one machine running the Collector. It is created the moment a
  Builder approves a connect code in the browser, and from then on it is
  identified by `public_key`, the raw Ed25519 key generated on that machine.

  `revoked_at` is a tombstone rather than a delete: Usage rows keep pointing at
  the Device that uploaded them, and a revoked Device is refused on its next
  request. `last_sync_at` is what /settings shows.
*/
export const devices = pgTable("devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  builderId: uuid("builder_id")
    .notNull()
    .references(() => builders.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  publicKey: text("public_key").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  /*
    The Sync watermark: the newest UTC day this Device has had accepted. It only
    moves forward, which is what makes a retroactive jump detectable; days older
    than the backfill window are Quarantined rather than silently taken.
  */
  lastSyncedDay: date("last_synced_day"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export type Device = typeof devices.$inferSelect;

/*
  A short code in flight between the Collector and the browser. The CLI creates
  the row unauthenticated, so it holds no Builder until someone signs in and
  approves it; `builder_id`, `device_id` and `approved_at` are set by the same
  write that creates the Device.

  `device_token` is the issued JWT, held only until the polling Collector picks
  it up: that read clears the column and stamps `token_issued_at`, which makes a
  code single-use. Codes are time limited by `expires_at` as well (10 minutes).
  Rejecting deletes the row, so a rejected code reads exactly like an expired one.
*/
export const deviceConnectCodes = pgTable("device_connect_codes", {
  code: text("code").primaryKey(),
  devicePubkey: text("device_pubkey").notNull(),
  deviceName: text("device_name").notNull(),
  builderId: uuid("builder_id").references(() => builders.id, { onDelete: "cascade" }),
  deviceId: uuid("device_id").references(() => devices.id, { onDelete: "cascade" }),
  deviceToken: text("device_token"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  tokenIssuedAt: timestamp("token_issued_at", { withTimezone: true }),
});

export type DeviceConnectCode = typeof deviceConnectCodes.$inferSelect;

/*
  Trust Level as stored (CONTEXT.md, ADR 0003). The values mirror `TrustLevel`
  in @tokenburnmarket/core; the sync code checks the two against each other.
*/
export const trustLevel = pgEnum("trust_level", ["verified", "reported", "quarantined"]);

/** One reason a row is not plainly Verified. Codes come from core, plus `duplicate_of_device`. */
export interface UsageReason {
  code: string;
  message: string;
  observed?: number;
  limit?: number;
}

/*
  Usage: one row per (Device, day, provider, model), written by a Sync.

  Rows stay per Device on purpose. Two Devices reading the same transcripts each
  keep their own row, and `duplicate_of_device_id` marks the later one so the
  Builder-day rollup counts the Usage once. Token counts are bigint because a
  heavy cache-reading day passes two billion tokens.

  `quarantine_reasons` holds every reason attached to the row, including the
  benign `no_receipt_stream` that makes a row Reported rather than Verified.
*/
export const usageDays = pgTable(
  "usage_days",
  {
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    builderId: uuid("builder_id")
      .notNull()
      .references(() => builders.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    /** The agent the Usage came from, as ccusage names it: claude, codex, gemini. */
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    cachedInputTokens: bigint("cached_input_tokens", { mode: "number" }).notNull().default(0),
    cacheWriteTokens: bigint("cache_write_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    reasoningTokens: bigint("reasoning_tokens", { mode: "number" }).notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 14, scale: 6, mode: "number" }).notNull().default(0),
    trustLevel: trustLevel("trust_level").notNull(),
    quarantineReasons: jsonb("quarantine_reasons").$type<UsageReason[]>().notNull().default([]),
    receiptCount: integer("receipt_count").notNull().default(0),
    /** Set when another Device of this Builder already reported these receipts. */
    duplicateOfDeviceId: uuid("duplicate_of_device_id").references(() => devices.id, {
      onDelete: "set null",
    }),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.deviceId, table.day, table.provider, table.model] }),
    index("usage_days_builder_day_idx").on(table.builderId, table.day),
  ],
);

export type UsageDayRow = typeof usageDays.$inferSelect;

/*
  Receipt Stream storage: the sha256 of a per-message identifier, never content.

  Keyed by (Device, hash) so re-syncing a day is a no-op, and indexed by
  (Builder, hash) so a Sync can ask the only question that matters: has another
  Device of this Builder already reported this message.
*/
export const receipts = pgTable(
  "receipts",
  {
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    builderId: uuid("builder_id")
      .notNull()
      .references(() => builders.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    hash: bytea("hash").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.deviceId, table.hash] }),
    index("receipts_builder_hash_idx").on(table.builderId, table.hash),
    index("receipts_builder_day_idx").on(table.builderId, table.day),
  ],
);

export type Receipt = typeof receipts.$inferSelect;

/*
  Builder-day rollup: the row Leaderboards, the mint and Market resolution read.
  Recomputed from `usage_days` on every Sync that touches the day, so it is
  always derivable and never the source of truth.

  `trust_level_min` is the weakest Trust Level among the day's rows, so one
  Quarantined row keeps the whole day out of boards without deleting anything.
*/
export const builderDays = pgTable(
  "builder_days",
  {
    builderId: uuid("builder_id")
      .notNull()
      .references(() => builders.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    costUsd: numeric("cost_usd", { precision: 14, scale: 6, mode: "number" }).notNull().default(0),
    totalTokens: bigint("total_tokens", { mode: "number" }).notNull().default(0),
    trustLevelMin: trustLevel("trust_level_min").notNull(),
    creditsMinted: credits("credits_minted").notNull().default(0),
    /** Which mint curve produced `credits_minted`. Null until the day is minted. */
    mintVersion: integer("mint_version"),
    /*
      How many times this day has been minted. Part of the ledger key, so an
      upward re-mint after late Usage arrives writes a new row for the
      difference while a plain re-run of the cron writes nothing.
    */
    mintRevision: integer("mint_revision").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.builderId, table.day] }),
    /*
      Leaderboards read a Season, not a Builder, so they need the day first: the
      primary key is (builder_id, day) and cannot serve a range over all
      Builders. This index is what keeps a board a range scan at 10k Builders.
    */
    index("builder_days_day_builder_idx").on(table.day, table.builderId),
  ],
);

export type BuilderDay = typeof builderDays.$inferSelect;

/*
  Why Credits moved. `signup` is the one-off grant, `mint` the daily faucet, the
  rest are Market flows that later tickets write.
*/
export const creditReason = pgEnum("credit_reason", [
  "signup",
  "mint",
  "buy",
  "sell",
  "payout",
  "refund",
]);

/*
  The Credit ledger: append only, and the only truth about a balance.
  `builders.credit_balance` is a cache of `sum(delta)` and is recomputed from
  here, never incremented blindly.

  `ref_id` names what caused the row, and the unique index over
  (builder_id, reason, ref_id) is what makes writers idempotent: the signup
  grant uses a constant ref, the mint uses `${day}:${revision}`. Postgres treats
  NULLs as distinct, so rows without a ref (none yet) are unconstrained.
*/
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    builderId: uuid("builder_id")
      .notNull()
      .references(() => builders.id, { onDelete: "cascade" }),
    delta: credits("delta").notNull(),
    reason: creditReason("reason").notNull(),
    refId: text("ref_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("credit_ledger_ref_idx").on(table.builderId, table.reason, table.refId),
    index("credit_ledger_builder_created_idx").on(table.builderId, table.createdAt),
  ],
);

export type CreditLedgerRow = typeof creditLedger.$inferSelect;

/*
  How wide a Market's audience is. A `community` Market names its Community, a
  `country` Market names its Region, a `global` Market names neither.
*/
export const marketScope = pgEnum("market_scope", ["community", "country", "global"]);

/** The templates from CONTEXT.md. `params` carries whatever the template needs. */
export const marketType = pgEnum("market_type", [
  "top_burner",
  "threshold",
  "head_to_head",
  "model_race",
]);

/*
  open: trading. closed: past `closes_at`, waiting on Usage. resolved: one
  Outcome paid out. voided: cancelled, Positions refunded at cost.
*/
export const marketStatus = pgEnum("market_status", ["open", "closed", "resolved", "voided"]);

/*
  Template parameters. A Market opened from a template stores exactly what
  `MarketTemplateParamsSchema` in core validates, which is everything a resolver
  needs and nothing else; the question and the rules sentence are derived from
  it on read, so a change of wording reaches Markets already open.
*/
export interface MarketParams {
  /** Which template these params belong to. Absent on the pre-template Markets. */
  template?: string;
  /** Human sentence shown under the question. Only on Markets with no template. */
  rules?: string;
  /** UTC day the measured period starts, inclusive. */
  periodStart?: string;
  /** UTC day the measured period ends, inclusive. */
  periodEnd?: string;
  /** What `threshold` Markets compare against, in USD of Usage. */
  thresholdUsd?: number;
  [key: string]: unknown;
}

/*
  A Market: a question about future Usage, priced by the LMSR (ADR 0002).

  `b` is the liquidity parameter fixed at creation; it never changes, because
  moving it would reprice every Position already held. `winning_outcome_id`
  carries no foreign key on purpose: outcomes reference the Market, and a cycle
  between the two tables would make either row impossible to insert first.
*/
export const markets = pgTable(
  "markets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: marketScope("scope").notNull(),
    communityId: uuid("community_id").references(() => communities.id, { onDelete: "cascade" }),
    country: char("country", { length: 2 }),
    type: marketType("type").notNull(),
    question: text("question").notNull(),
    params: jsonb("params").$type<MarketParams>().notNull().default({}),
    b: numeric("b", { precision: 14, scale: 4, mode: "number" }).notNull(),
    opensAt: timestamp("opens_at", { withTimezone: true }).notNull().defaultNow(),
    closesAt: timestamp("closes_at", { withTimezone: true }).notNull(),
    /** When Usage is read to settle. Later than `closes_at` to absorb late Syncs. */
    resolvesAt: timestamp("resolves_at", { withTimezone: true }).notNull(),
    status: marketStatus("status").notNull().default("open"),
    winningOutcomeId: uuid("winning_outcome_id"),
    /*
      Set when settling found Quarantined Usage behind the question: the answer
      is not knowable yet, so the resolver waits until this time and voids the
      Market if the review has still not cleared by then.
    */
    holdUntil: timestamp("hold_until", { withTimezone: true }),
    /** Why a Market is held or voided, in the words traders are shown. */
    resolutionNote: text("resolution_note"),
    /*
      What makes the weekly cron idempotent: `template:scope:monday` for a
      Market the job opened, null for one a person opened. Unique, so a second
      run of the same week inserts nothing rather than a duplicate.
    */
    autoKey: text("auto_key").unique(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => builders.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("markets_status_closes_idx").on(table.status, table.closesAt),
    index("markets_community_idx").on(table.communityId, table.status),
  ],
);

export type Market = typeof markets.$inferSelect;

/*
  One answer to a Market's question. `ref` says what the resolver should measure
  (a Builder, a model, a provider); `label` is what a person reads. `sort` fixes
  the display order, which is also the order the LMSR sees the shares vector in,
  so prices on screen line up with prices on the server.
*/
export const outcomes = pgTable(
  "outcomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketId: uuid("market_id")
      .notNull()
      .references(() => markets.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    ref: jsonb("ref").$type<Record<string, unknown>>().notNull().default({}),
    sharesOutstanding: numeric("shares_outstanding", {
      precision: 14,
      scale: 4,
      mode: "number",
    })
      .notNull()
      .default(0),
    sort: integer("sort").notNull().default(0),
  },
  (table) => [uniqueIndex("outcomes_market_sort_idx").on(table.marketId, table.sort)],
);

export type Outcome = typeof outcomes.$inferSelect;

/*
  What a Builder holds in one Outcome. `cost_basis` is what they paid for the
  shares still held, reduced proportionally on a sell, so profit at resolution
  reads straight off the row. Shares are never negative: there is no shorting.
*/
export const positions = pgTable(
  "positions",
  {
    marketId: uuid("market_id")
      .notNull()
      .references(() => markets.id, { onDelete: "cascade" }),
    outcomeId: uuid("outcome_id")
      .notNull()
      .references(() => outcomes.id, { onDelete: "cascade" }),
    builderId: uuid("builder_id")
      .notNull()
      .references(() => builders.id, { onDelete: "cascade" }),
    shares: numeric("shares", { precision: 14, scale: 4, mode: "number" }).notNull().default(0),
    costBasis: credits("cost_basis").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.marketId, table.outcomeId, table.builderId] }),
    index("positions_builder_idx").on(table.builderId),
  ],
);

export type Position = typeof positions.$inferSelect;

export const tradeSide = pgEnum("trade_side", ["buy", "sell"]);

/*
  Every fill against the AMM, append only. `price_after` is the Outcome's
  instantaneous price once the trade landed, which is what draws the price
  chart: the Market's own history, not a separate time series to keep in step.

  `credits` is always positive; `side` says which way it moved. The matching
  ledger row uses the trade id as its ref, so the two reconcile row for row.
*/
export const trades = pgTable(
  "trades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketId: uuid("market_id")
      .notNull()
      .references(() => markets.id, { onDelete: "cascade" }),
    outcomeId: uuid("outcome_id")
      .notNull()
      .references(() => outcomes.id, { onDelete: "cascade" }),
    builderId: uuid("builder_id")
      .notNull()
      .references(() => builders.id, { onDelete: "cascade" }),
    side: tradeSide("side").notNull(),
    shares: numeric("shares", { precision: 14, scale: 4, mode: "number" }).notNull(),
    credits: credits("credits").notNull(),
    priceAfter: numeric("price_after", { precision: 9, scale: 6, mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("trades_market_created_idx").on(table.marketId, table.createdAt)],
);

export type Trade = typeof trades.$inferSelect;

/*
  What an Admin decided about a Quarantined Usage row. `verified` and `reported`
  put the row back into Leaderboards, Credits and Market resolution at that Trust
  Level; `keep` leaves it out and records why.
*/
export const quarantineDecision = pgEnum("quarantine_decision", ["verified", "reported", "keep"]);

/*
  The review log for Quarantined Usage. Append only: a row is a decision that was
  made, not the current state, which stays on `usage_days.trust_level`. The four
  columns before `decision` are the Usage row's key, repeated rather than joined
  through a surrogate because `usage_days` has none.

  No foreign key back to `usage_days`: a composite reference would sit in the way
  of the Sync upsert for no gain, and the note on a row that later left with its
  Device is still worth reading.
*/
export const quarantineReviews = pgTable(
  "quarantine_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    decision: quarantineDecision("decision").notNull(),
    /** What the reviewer wanted the next reviewer to know. */
    note: text("note"),
    reviewerId: uuid("reviewer_id")
      .notNull()
      .references(() => builders.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("quarantine_reviews_row_idx").on(table.deviceId, table.day, table.provider, table.model),
  ],
);

export type QuarantineReviewRow = typeof quarantineReviews.$inferSelect;
