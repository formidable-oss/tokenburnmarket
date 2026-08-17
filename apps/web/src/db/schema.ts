/*
  Database schema. One file, append new tables as tickets land.
  Credits are whole units, so credit-like values stay integer; timestamps are UTC.
*/
import {
  bigint,
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
  uuid,
} from "drizzle-orm/pg-core";

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
export const builders = pgTable("builders", {
  id: uuid("id").primaryKey().defaultRandom(),
  githubId: text("github_id").notNull().unique(),
  handle: text("handle").notNull().unique(),
  avatarUrl: text("avatar_url"),
  xHandle: text("x_handle"),
  country: char("country", { length: 2 }),
  creditBalance: integer("credit_balance").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
    creditsMinted: integer("credits_minted").notNull().default(0),
    /** Which mint curve produced `credits_minted`. Null until the day is minted. */
    mintVersion: integer("mint_version"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.builderId, table.day] })],
);

export type BuilderDay = typeof builderDays.$inferSelect;
