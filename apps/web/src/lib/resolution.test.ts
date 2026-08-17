/*
  The resolution run, against a store that models the one database guarantee it
  leans on: the unique (builder, reason, ref) index on the ledger. Running the
  cron twice has to leave the same Credits behind as running it once, and a hold
  has to become a void rather than a second answer.
*/
import { describe, expect, it } from "vitest";
import type { MarketParams } from "@/db/schema";
import {
  HOLD_EXPIRED_REASON,
  marketRef,
  planPayouts,
  planRefunds,
  planResolution,
  runResolution,
  type ResolutionStore,
  type ResolvableMarket,
  type SettlementPosition,
} from "./resolution";
import type { ResolutionSnapshot } from "@tokenburnmarket/core";

const ADA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BEN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MARKET = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const COMMUNITY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const YES = "outcome-yes";
const NO = "outcome-no";

const thresholdParams: MarketParams = {
  template: "threshold",
  scope: { kind: "community", communityId: COMMUNITY, communityName: "Nightshift" },
  period: { start: "2026-08-17", end: "2026-08-23" },
  threshold: { builderId: ADA, handle: "ada", costUsd: 50 },
} as unknown as MarketParams;

function market(overrides: Partial<ResolvableMarket> = {}): ResolvableMarket {
  return {
    id: MARKET,
    params: thresholdParams,
    holdUntil: null,
    outcomes: [
      { id: YES, ref: { kind: "threshold_met" } },
      { id: NO, ref: { kind: "threshold_missed" } },
    ],
    ...overrides,
  };
}

function snapshot(builders: ResolutionSnapshot["builders"]): ResolutionSnapshot {
  return { builders, models: [] };
}

/*
  A store with the ledger's unique ref in it, and nothing else: enough to prove
  the run loop cannot pay twice, without a database.
*/
function fakeStore(
  market: ResolvableMarket,
  usage: ResolutionSnapshot,
  positions: SettlementPosition[],
) {
  const ledger: { builderId: string; reason: string; refId: string; delta: number }[] = [];
  const state = { status: "closed", holdUntil: market.holdUntil, note: null as string | null };

  const write = (reason: "payout" | "refund", writes: { builderId: string; credits: number }[]) => {
    let credits = 0;
    let builders = 0;
    for (const row of writes) {
      const refId = marketRef(market.id);
      const taken = ledger.some(
        (entry) =>
          entry.builderId === row.builderId && entry.reason === reason && entry.refId === refId,
      );
      if (taken) continue;
      ledger.push({ builderId: row.builderId, reason, refId, delta: row.credits });
      credits += row.credits;
      builders += 1;
    }
    return { builders, credits };
  };

  const store: ResolutionStore = {
    async closeExpired() {
      return 0;
    },
    async dueForResolution() {
      // Settled markets are no longer due, exactly as the SQL filter has it.
      return state.status === "closed" ? [{ ...market, holdUntil: state.holdUntil }] : [];
    },
    async snapshotFor() {
      return usage;
    },
    async payout(_marketId, winningOutcomeId) {
      const result = write("payout", planPayouts(positions, winningOutcomeId));
      state.status = "resolved";
      return result;
    },
    async refund(_marketId, reason) {
      const result = write("refund", planRefunds(positions));
      state.status = "voided";
      state.note = reason;
      return result;
    },
    async hold(_marketId, until, reason) {
      state.holdUntil = until;
      state.note = reason;
    },
  };

  return { store, ledger, state };
}

const positions: SettlementPosition[] = [
  { builderId: ADA, outcomeId: YES, shares: 10, costBasis: 4 },
  { builderId: ADA, outcomeId: NO, shares: 2, costBasis: 1.5 },
  { builderId: BEN, outcomeId: YES, shares: 5, costBasis: 3.25 },
];

describe("planPayouts", () => {
  it("pays 1 credit per winning share and nothing for the rest", () => {
    expect(planPayouts(positions, YES)).toEqual([
      { builderId: ADA, credits: 10 },
      { builderId: BEN, credits: 5 },
    ]);
  });

  it("pays nobody when the winning outcome was untraded", () => {
    expect(planPayouts(positions, "outcome-nobody")).toEqual([]);
  });
});

describe("planRefunds", () => {
  it("returns cost basis exactly, summed over a builder's positions", () => {
    expect(planRefunds(positions)).toEqual([
      { builderId: ADA, credits: 5.5 },
      { builderId: BEN, credits: 3.25 },
    ]);
  });
});

describe("planResolution", () => {
  it("skips a market that was not opened from a template", () => {
    const action = planResolution(
      market({ params: { rules: "handwritten" } }),
      snapshot([]),
      new Date(),
    );
    expect(action).toMatchObject({ kind: "skip" });
  });

  it("holds the first time a participant is quarantined", () => {
    const now = new Date("2026-08-25T00:00:00Z");
    const action = planResolution(
      market(),
      snapshot([
        { builderId: ADA, handle: "ada", costUsd: 60, totalTokens: 0, quarantined: true },
      ]),
      now,
    );
    expect(action).toMatchObject({ kind: "hold" });
    if (action.kind !== "hold") return;
    expect(action.until.toISOString()).toBe("2026-08-26T00:00:00.000Z");
  });

  it("voids once the hold has run out", () => {
    const action = planResolution(
      market({ holdUntil: new Date("2026-08-26T00:00:00Z") }),
      snapshot([
        { builderId: ADA, handle: "ada", costUsd: 60, totalTokens: 0, quarantined: true },
      ]),
      new Date("2026-08-26T00:10:00Z"),
    );
    expect(action).toEqual({ kind: "void", reason: HOLD_EXPIRED_REASON });
  });

  it("resolves after a hold when the quarantine cleared", () => {
    const action = planResolution(
      market({ holdUntil: new Date("2026-08-26T00:00:00Z") }),
      snapshot([
        { builderId: ADA, handle: "ada", costUsd: 60, totalTokens: 0, quarantined: false },
      ]),
      new Date("2026-08-26T00:10:00Z"),
    );
    expect(action).toEqual({ kind: "resolve", winningOutcomeId: YES });
  });

  it("voids when no outcome on the book covers the result", () => {
    const action = planResolution(
      market({ outcomes: [{ id: NO, ref: { kind: "threshold_missed" } }] }),
      snapshot([
        { builderId: ADA, handle: "ada", costUsd: 60, totalTokens: 0, quarantined: false },
      ]),
      new Date(),
    );
    expect(action).toMatchObject({ kind: "void" });
  });
});

describe("runResolution", () => {
  const settled = snapshot([
    { builderId: ADA, handle: "ada", costUsd: 60, totalTokens: 100, quarantined: false },
  ]);

  it("pays winners once, however often it runs", async () => {
    const { store, ledger } = fakeStore(market(), settled, positions);

    const first = await runResolution(store, new Date("2026-08-25T00:00:00Z"));
    expect(first).toMatchObject({ resolved: 1, paid: 15 });

    const second = await runResolution(store, new Date("2026-08-25T00:10:00Z"));
    expect(second).toMatchObject({ resolved: 0, paid: 0 });
    expect(ledger).toHaveLength(2);
    expect(ledger.map((row) => row.delta)).toEqual([10, 5]);
  });

  it("pays nothing twice even if the same market comes back due", async () => {
    const { store, ledger } = fakeStore(market(), settled, positions);
    // A store that keeps handing the market back is the torn-run case.
    store.dueForResolution = async () => [market()];

    await runResolution(store, new Date("2026-08-25T00:00:00Z"));
    await runResolution(store, new Date("2026-08-25T00:10:00Z"));

    expect(ledger).toHaveLength(2);
    expect(ledger.reduce((total, row) => total + row.delta, 0)).toBe(15);
  });

  it("holds, then voids and refunds cost basis exactly", async () => {
    const quarantined = snapshot([
      { builderId: ADA, handle: "ada", costUsd: 60, totalTokens: 100, quarantined: true },
    ]);
    const { store, ledger, state } = fakeStore(market(), quarantined, positions);

    const held = await runResolution(store, new Date("2026-08-25T00:00:00Z"));
    expect(held).toMatchObject({ held: 1, resolved: 0, voided: 0 });
    expect(ledger).toHaveLength(0);

    const voided = await runResolution(store, new Date("2026-08-26T00:01:00Z"));
    expect(voided).toMatchObject({ voided: 1, refunded: 8.75 });
    expect(state.note).toBe(HOLD_EXPIRED_REASON);

    const again = await runResolution(store, new Date("2026-08-26T00:11:00Z"));
    expect(again).toMatchObject({ voided: 0, refunded: 0 });
    expect(ledger).toHaveLength(2);
    // Refunds return what was paid in, to the cent.
    expect(ledger.reduce((total, row) => total + row.delta, 0)).toBe(8.75);
  });
});
