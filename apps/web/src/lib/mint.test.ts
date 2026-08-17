/*
  The mint against an in-memory ledger: the same code the cron runs, with maps
  instead of Postgres. What is pinned down here is the part that costs real
  Credits if it is wrong: a re-run mints nothing, a Trust Level decides the
  multiplier, a day that grew tops up by the difference only, and the cached
  balance always equals the sum of the rows.
*/
import { describe, expect, it } from "vitest";
import { SIGNUP_GRANT_CREDITS, mintForDay, roundCredits } from "@tokenburnmarket/core";
import type { TrustLevel } from "@tokenburnmarket/core";
import {
  grantSignupCredits,
  lastMintableDay,
  planMint,
  remintBuilderDay,
  runMint,
  type MintCandidate,
  type MintStore,
} from "./mint";

const BUILDER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-08-17T01:00:00.000Z");
/** Closed at 2026-08-16T00:00Z, so it is 25 hours past the buffer at NOW. */
const DAY = "2026-08-15";

interface LedgerRow {
  builderId: string;
  delta: number;
  reason: string;
  refId: string | null;
}

interface Memory extends MintStore {
  ledger: LedgerRow[];
  days: Map<string, MintCandidate>;
  balances: Map<string, number>;
}

function day(overrides: Partial<MintCandidate> = {}): MintCandidate {
  return {
    builderId: BUILDER,
    day: DAY,
    costUsd: 12,
    trustLevelMin: "verified",
    creditsMinted: 0,
    mintRevision: 0,
    ...overrides,
  };
}

function memoryStore(candidates: MintCandidate[]): Memory {
  const days = new Map(candidates.map((row) => [`${row.builderId}|${row.day}`, { ...row }]));
  const ledger: LedgerRow[] = [];
  const balances = new Map<string, number>();

  const insert = (row: LedgerRow): boolean => {
    const clash = ledger.some(
      (existing) =>
        existing.builderId === row.builderId &&
        existing.reason === row.reason &&
        existing.refId === row.refId,
    );
    if (clash) return false;
    ledger.push(row);
    return true;
  };

  return {
    ledger,
    days,
    balances,
    async candidates(throughDay) {
      return [...days.values()].filter((row) => row.day <= throughDay && row.costUsd > 0);
    },
    async candidateFor(builderId, dayKey) {
      return days.get(`${builderId}|${dayKey}`) ?? null;
    },
    async recordMint(write) {
      const inserted = insert({
        builderId: write.builderId,
        delta: write.delta,
        reason: "mint",
        refId: write.refId,
      });
      const row = days.get(`${write.builderId}|${write.day}`);
      if (row && row.mintRevision === write.revision) {
        row.creditsMinted = write.credits;
        row.mintRevision = write.revision + 1;
      }
      return inserted;
    },
    async refreshBalances(builderIds) {
      for (const builderId of builderIds) {
        const sum = ledger
          .filter((row) => row.builderId === builderId)
          .reduce((total, row) => roundCredits(total + row.delta), 0);
        balances.set(builderId, sum);
      }
    },
    async grantSignup(builderId, credits) {
      return insert({ builderId, delta: credits, reason: "signup", refId: "grant" });
    },
  };
}

describe("lastMintableDay", () => {
  it("waits for the day to close and for the late-sync buffer", () => {
    // 2026-08-15 closes at 2026-08-16T00:00Z and is mintable from 2026-08-17T00:00Z.
    expect(lastMintableDay(new Date("2026-08-16T23:59:00.000Z"))).toBe("2026-08-14");
    expect(lastMintableDay(new Date("2026-08-17T00:00:00.000Z"))).toBe("2026-08-15");
    expect(lastMintableDay(NOW)).toBe("2026-08-15");
  });
});

describe("planMint", () => {
  it("mints Reported days at half the curve and Quarantined days at nothing", () => {
    const verified = planMint(day({ costUsd: 30, trustLevelMin: "verified" }));
    const reported = planMint(day({ costUsd: 30, trustLevelMin: "reported" }));
    const quarantined = planMint(day({ costUsd: 30, trustLevelMin: "quarantined" }));

    expect(verified?.delta).toBeCloseTo(mintForDay(30, "verified").credits, 4);
    expect(reported?.delta).toBeCloseTo(verified!.delta / 2, 4);
    expect(quarantined).toBeNull();
  });

  it("never claws back a day whose usage shrank", () => {
    expect(planMint(day({ costUsd: 5, creditsMinted: 12 }))).toBeNull();
  });
});

describe("remintBuilderDay", () => {
  it("mints a day an admin just cleared, and adds nothing on a second call", async () => {
    // Quarantined at first, so the cron left it at zero.
    const store = memoryStore([day({ costUsd: 30, trustLevelMin: "quarantined" })]);
    await runMint(store, NOW);
    expect(store.ledger).toHaveLength(0);

    store.days.get(`${BUILDER}|${DAY}`)!.trustLevelMin = "verified";
    const expected = mintForDay(30, "verified").credits;

    expect(await remintBuilderDay(store, BUILDER, DAY, NOW)).toBeCloseTo(expected, 4);
    expect(await remintBuilderDay(store, BUILDER, DAY, NOW)).toBe(0);
    expect(store.ledger).toHaveLength(1);
    expect(store.balances.get(BUILDER)).toBeCloseTo(expected, 4);
  });

  it("leaves a day that has not cleared the buffer to the cron", async () => {
    const store = memoryStore([day({ day: "2026-08-16", costUsd: 30 })]);
    expect(await remintBuilderDay(store, BUILDER, "2026-08-16", NOW)).toBe(0);
    expect(store.ledger).toHaveLength(0);
  });

  it("adds nothing for a builder day nobody has rolled up", async () => {
    const store = memoryStore([]);
    expect(await remintBuilderDay(store, BUILDER, DAY, NOW)).toBe(0);
  });
});

describe("runMint", () => {
  it("skips days that have not cleared the buffer", async () => {
    // 2026-08-16 only closed an hour before NOW.
    const store = memoryStore([day({ day: "2026-08-16" })]);
    const result = await runMint(store, NOW);

    expect(result).toMatchObject({ throughDay: "2026-08-15", minted: 0 });
    expect(store.ledger).toHaveLength(0);
  });

  it("mints a closed day once, and a second run mints nothing", async () => {
    const store = memoryStore([day({ costUsd: 30 })]);
    const expected = mintForDay(30, "verified").credits;

    const first = await runMint(store, NOW);
    expect(first.minted).toBe(1);
    expect(first.credits).toBeCloseTo(expected, 4);

    const before = [...store.ledger];
    const second = await runMint(store, NOW);

    expect(second.minted).toBe(0);
    expect(store.ledger).toEqual(before);
    expect(store.balances.get(BUILDER)).toBeCloseTo(expected, 4);
  });

  it("tops up a day whose usage grew, by the difference only", async () => {
    const store = memoryStore([day({ costUsd: 30 })]);
    await runMint(store, NOW);

    const grown = store.days.get(`${BUILDER}|${DAY}`)!;
    grown.costUsd = 80;
    const result = await runMint(store, NOW);

    const first = mintForDay(30, "verified").credits;
    const total = mintForDay(80, "verified").credits;
    expect(result.minted).toBe(1);
    expect(store.ledger).toHaveLength(2);
    expect(store.ledger[1]!.delta).toBeCloseTo(roundCredits(total - first), 4);
    expect(store.ledger[1]!.refId).toBe(`${DAY}:1`);
    expect(store.balances.get(BUILDER)).toBeCloseTo(total, 4);
  });

  it("refuses a second writer holding the same revision", async () => {
    const store = memoryStore([day({ costUsd: 30 })]);
    const candidate = day({ costUsd: 30 });
    const write = planMint(candidate)!;

    expect(await store.recordMint(write)).toBe(true);
    // Same revision, as a run that read the Builder-day before the first write.
    expect(await store.recordMint(write)).toBe(false);
    expect(store.ledger).toHaveLength(1);
  });

  it("keeps the cached balance equal to the sum of the ledger", async () => {
    const store = memoryStore([
      day({ costUsd: 30 }),
      day({ day: "2026-08-14", costUsd: 8, trustLevelMin: "reported" }),
      day({ builderId: OTHER, costUsd: 100 }),
      day({ builderId: OTHER, day: "2026-08-13", costUsd: 40, trustLevelMin: "quarantined" }),
    ]);

    await grantSignupCredits(store, BUILDER);
    await grantSignupCredits(store, OTHER);
    await runMint(store, NOW);
    // A growing day, a re-run and a second grant must not disturb the identity.
    store.days.get(`${OTHER}|2026-08-15`)!.costUsd = 260;
    await runMint(store, NOW);
    await runMint(store, NOW);
    await grantSignupCredits(store, BUILDER);

    for (const builderId of [BUILDER, OTHER]) {
      const sum = store.ledger
        .filter((row) => row.builderId === builderId)
        .reduce((total, row) => roundCredits(total + row.delta), 0);
      expect(store.balances.get(builderId)).toBeCloseTo(sum, 4);
    }

    const quarantinedRows = store.ledger.filter((row) => row.refId === "2026-08-13:0");
    expect(quarantinedRows).toHaveLength(0);
  });
});

describe("grantSignupCredits", () => {
  it("grants once per Builder", async () => {
    const store = memoryStore([]);

    expect(await grantSignupCredits(store, BUILDER)).toBe(true);
    expect(await grantSignupCredits(store, BUILDER)).toBe(false);

    expect(store.ledger).toHaveLength(1);
    expect(store.ledger[0]).toMatchObject({ delta: SIGNUP_GRANT_CREDITS, reason: "signup" });
    expect(store.balances.get(BUILDER)).toBe(SIGNUP_GRANT_CREDITS);
  });
});

describe("trust levels", () => {
  it("covers every Trust Level the rollup can produce", () => {
    const levels: TrustLevel[] = ["verified", "reported", "quarantined"];
    const minted = levels.map((level) => planMint(day({ costUsd: 20, trustLevelMin: level }))?.delta ?? 0);
    expect(minted).toEqual([20, 10, 0]);
  });
});
