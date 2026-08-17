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
