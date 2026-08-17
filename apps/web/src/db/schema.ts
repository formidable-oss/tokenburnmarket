/*
  Database schema. One file, append new tables as tickets land.
  Credits are whole units, so credit-like values stay integer; timestamps are UTC.
*/
import { char, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
