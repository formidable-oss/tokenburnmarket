/*
  Database schema. One file, append new tables as tickets land.
  Credits are whole units, so credit-like values stay integer; timestamps are UTC.
*/
import {
  char,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

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
