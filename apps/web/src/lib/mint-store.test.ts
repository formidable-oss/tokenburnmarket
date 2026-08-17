/*
  The one thing about the mint's SQL that cannot be caught by an in-memory
  store: `and(a, b, c)` renders as `a and b and c`, so an unparenthesised `or`
  inside c binds looser than the whole conjunction and the day bound stops
  applying. That mints days that have not closed yet.
*/
import { describe, expect, it } from "vitest";
import { QueryBuilder } from "drizzle-orm/pg-core";
import { builderDays } from "@/db/schema";
import { mintCandidateFilter } from "./mint-store";

function render(throughDay: string) {
  return new QueryBuilder()
    .select()
    .from(builderDays)
    .where(mintCandidateFilter(throughDay))
    .toSQL();
}

describe("mintCandidateFilter", () => {
  it("keeps the day bound in force by parenthesising the or", () => {
    const { sql, params } = render("2026-08-15");
    const condition = sql.slice(sql.indexOf("where ") + "where ".length).replace(/\s+/g, " ");

    expect(condition).toContain(`"builder_days"."day" <= $1`);
    expect(params[0]).toBe("2026-08-15");
    // Every `or` sits inside a group of its own, so nothing escapes the `and`.
    expect(condition).toMatch(/\(("builder_days"\."mint_version") is distinct from \$2 or [^()]*\)/);
  });
});
