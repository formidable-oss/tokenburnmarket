/*
  The automatic job against an in-memory store: the same code the cron runs, with a
  map instead of Postgres. What is pinned down is the part that costs real
  Credits if it is wrong: Community markets stay weekly, Model Races refresh
  daily, repeat runs are harmless, and every Market it opens is tradeable.
*/
import { describe, expect, it } from "vitest";
import { SOMEONE_ELSE_LABEL, autoMarketKey } from "@tokenburnmarket/core";
import { runAutoMarkets, type AutoCommunity, type AutoMarketStore } from "./auto-markets";
import { raceModels, type MarketPlan } from "./market-templates";

const MONDAY = new Date("2026-08-17T00:05:00.000Z");
const TUESDAY = new Date("2026-08-18T00:05:00.000Z");
const NEXT_MONDAY = new Date("2026-08-24T00:05:00.000Z");
const ADMIN = "99999999-9999-4999-8999-999999999999";
const COMMUNITY = "33333333-3333-4333-8333-333333333333";

function community(overrides: Partial<AutoCommunity> = {}): AutoCommunity {
  return {
    id: COMMUNITY,
    name: "Formidable",
    ownerId: "11111111-1111-4111-8111-111111111111",
    members: [
      { builderId: "11111111-1111-4111-8111-111111111111", handle: "alex" },
      { builderId: "22222222-2222-4222-8222-222222222222", handle: "theo" },
    ],
    ...overrides,
  };
}

interface Memory extends AutoMarketStore {
  written: { plan: MarketPlan; createdBy: string }[];
}

function memoryStore(
  options: { communities?: AutoCommunity[]; models?: string[]; admin?: string | null } = {},
): Memory {
  const written: { plan: MarketPlan; createdBy: string }[] = [];
  const keys = new Set<string>();

  return {
    written,
    communities: async () => options.communities ?? [community()],
    topModels: async (limit) =>
      (options.models ?? ["gpt-5.6-sol", "claude-opus-5"]).slice(0, limit),
    builderCount: async () => 40,
    adminBuilderId: async () => (options.admin === undefined ? ADMIN : options.admin),
    // The unique `auto_key` column, in one line.
    create: async (plan, createdBy) => {
      if (keys.has(plan.autoKey!)) return false;
      keys.add(plan.autoKey!);
      written.push({ plan, createdBy });
      return true;
    },
  };
}

describe("automatic market creation", () => {
  it("opens a top burner per community and one global model race", async () => {
    const store = memoryStore();
    const run = await runAutoMarkets(store, MONDAY);

    expect(run.week).toEqual({ start: "2026-08-17", end: "2026-08-23" });
    expect(run.created).toEqual([
      autoMarketKey("top_burner", COMMUNITY, run.week),
      autoMarketKey("model_race", "global", run.day),
    ]);
    expect(store.written).toHaveLength(2);
  });

  it("is idempotent when it runs twice on the same day", async () => {
    const store = memoryStore();
    await runAutoMarkets(store, MONDAY);
    const second = await runAutoMarkets(store, new Date("2026-08-17T12:00:00.000Z"));

    expect(second.created).toEqual([]);
    expect(second.skipped).toHaveLength(2);
    expect(store.written).toHaveLength(2);
  });

  it("opens a current model race every day while keeping community markets weekly", async () => {
    const store = memoryStore({ models: ["gpt-5.6-sol", "claude-opus-5"] });
    await runAutoMarkets(store, MONDAY);
    const nextDay = await runAutoMarkets(store, TUESDAY);
    const day = { start: "2026-08-18", end: "2026-08-18" };

    expect(nextDay.created).toEqual([autoMarketKey("model_race", "global", day)]);
    expect(nextDay.skipped).toEqual([autoMarketKey("top_burner", COMMUNITY, nextDay.week)]);
    expect(store.written).toHaveLength(3);
    expect(store.written[2].plan.params).toMatchObject({
      template: "model_race",
      period: day,
      models: ["gpt-5.6-sol", "claude-opus-5"],
    });
  });

  it("opens a fresh set once the week turns over", async () => {
    const store = memoryStore();
    await runAutoMarkets(store, MONDAY);
    const next = await runAutoMarkets(store, NEXT_MONDAY);

    expect(next.created).toHaveLength(2);
    expect(store.written).toHaveLength(4);
    expect(next.week.start).toBe("2026-08-24");
  });

  it("opens each community's market in the owner's name", async () => {
    const store = memoryStore();
    await runAutoMarkets(store, MONDAY);
    const [topBurner, modelRace] = store.written;

    expect(topBurner.createdBy).toBe(community().ownerId);
    expect(modelRace.createdBy).toBe(ADMIN);
  });

  it("puts someone else on every top burner it opens", async () => {
    const store = memoryStore();
    await runAutoMarkets(store, MONDAY);
    const [topBurner] = store.written;

    expect(topBurner.plan.outcomes.map((outcome) => outcome.label)).toEqual([
      "@alex",
      "@theo",
      SOMEONE_ELSE_LABEL,
    ]);
  });

  it("keeps community markets weekly and model races daily", async () => {
    const store = memoryStore();
    await runAutoMarkets(store, MONDAY);
    const [topBurner, modelRace] = store.written;

    expect(topBurner.plan.closesAt.toISOString()).toBe("2026-08-24T00:00:00.000Z");
    expect(topBurner.plan.resolvesAt.toISOString()).toBe("2026-08-25T00:00:00.000Z");
    expect(modelRace.plan.closesAt.toISOString()).toBe("2026-08-18T00:00:00.000Z");
    expect(modelRace.plan.resolvesAt.toISOString()).toBe("2026-08-19T00:00:00.000Z");
  });

  it("sizes liquidity from the audience: members here, everyone globally", async () => {
    const store = memoryStore();
    await runAutoMarkets(store, MONDAY);
    const [topBurner, modelRace] = store.written;

    expect(topBurner.plan.b).toBe(30); // 20 + 5 * 2 members
    expect(modelRace.plan.b).toBe(300); // 100 + 5 * 40 builders
  });

  it("skips a community with nobody in it rather than opening an empty board", async () => {
    const store = memoryStore({ communities: [community({ members: [] })] });
    const run = await runAutoMarkets(store, MONDAY);

    expect(run.declined[0].reason).toBe("no members");
    expect(store.written.map((row) => row.plan.type)).toEqual(["model_race"]);
  });

  it("skips the model race when no admin exists to open it", async () => {
    const store = memoryStore({ admin: null });
    const run = await runAutoMarkets(store, MONDAY);

    expect(run.declined).toEqual([
      { key: autoMarketKey("model_race", "global", run.day), reason: "no admin builder" },
    ]);
    expect(store.written.map((row) => row.plan.type)).toEqual(["top_burner"]);
  });

  it("declines a model race until at least two models have recent usage", async () => {
    const store = memoryStore({ models: ["gpt-5.6-sol"] });
    const run = await runAutoMarkets(store, MONDAY);

    expect(run.declined).toEqual([
      {
        key: autoMarketKey("model_race", "global", run.day),
        reason: "not enough recent models",
      },
    ]);
    expect(store.written.map((row) => row.plan.type)).toEqual(["top_burner"]);
  });

  it("races only distinct models people actually use", async () => {
    expect(raceModels(["gpt-5.6-sol", "gpt-5.6-sol", "claude-opus-5"])).toEqual([
      "gpt-5.6-sol",
      "claude-opus-5",
    ]);
    expect(raceModels(["gpt-5.6-sol"])).toEqual(["gpt-5.6-sol"]);
    expect(raceModels([])).toEqual([]);
  });
});
