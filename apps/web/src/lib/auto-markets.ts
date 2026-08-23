/*
  The Markets nobody has to remember to open: a weekly Top Burner in every
  Community and a daily global Model Race made from the models people are
  burning now.

  Expressed against a small store interface, the same shape the mint uses, so
  the decisions are testable without a database. One rule holds it together:
  every Market the job opens carries an `auto_key` of template, scope and
  period start, and the column is unique, so a second run in the same period
  inserts nothing rather than a second market to split the liquidity.
*/
import {
  MODEL_RACE_MODELS,
  autoMarketKey,
  utcDayOf,
  utcWeekOf,
  type MarketPeriod,
  type MemberSnapshot,
  type ModelRaceParams,
  type TopBurnerParams,
} from "@tokenburnmarket/core";
import { planTemplateMarket, raceModels, type MarketPlan } from "./market-templates";

/** A Community as the job reads it, with its members already ranked. */
export interface AutoCommunity {
  id: string;
  name: string;
  /** Auto-created Community Markets are opened in the owner's name. */
  ownerId: string;
  members: MemberSnapshot[];
}

export interface AutoMarketStore {
  communities(): Promise<AutoCommunity[]>;
  /** The models with the most tokens lately, most burnt first. May be empty. */
  topModels(limit: number): Promise<string[]>;
  /** Everyone signed up, which is what sizes a global Market's liquidity. */
  builderCount(): Promise<number>;
  /** The Builder a global Market is opened as: an admin. Null when none exists yet. */
  adminBuilderId(): Promise<string | null>;
  /** Writes the Market and its Outcomes. False when the `auto_key` was already taken. */
  create(plan: MarketPlan, createdBy: string): Promise<boolean>;
}

export interface AutoMarketRun {
  day: MarketPeriod;
  week: MarketPeriod;
  /** The `auto_key` of every Market this run opened. */
  created: string[];
  /** Keys that already existed, which is the normal state after the first run. */
  skipped: string[];
  /** Why a Market was not opened at all, keyed the same way. */
  declined: { key: string; reason: string }[];
}

/** Opens the current weekly Community Markets and today's global Model Race. */
export async function runAutoMarkets(
  store: AutoMarketStore,
  now: Date = new Date(),
): Promise<AutoMarketRun> {
  const day = utcDayOf(now);
  const week = utcWeekOf(now);
  const run: AutoMarketRun = { day, week, created: [], skipped: [], declined: [] };

  const record = async (key: string, plan: MarketPlan, createdBy: string) => {
    const created = await store.create({ ...plan, autoKey: key }, createdBy);
    (created ? run.created : run.skipped).push(key);
  };

  for (const community of await store.communities()) {
    const key = autoMarketKey("top_burner", community.id, week);
    if (community.members.length === 0) {
      run.declined.push({ key, reason: "no members" });
      continue;
    }
    const params: TopBurnerParams = {
      template: "top_burner",
      scope: { kind: "community", communityId: community.id, communityName: community.name },
      period: week,
    };
    const plan = planTemplateMarket(
      { params, members: community.members, audience: community.members.length },
      now,
    );
    if (!plan.ok) {
      run.declined.push({ key, reason: plan.error });
      continue;
    }
    await record(key, plan.value, community.ownerId);
  }

  const raceKey = autoMarketKey("model_race", "global", day);
  const admin = await store.adminBuilderId();
  if (!admin) {
    // A global Market speaks for the site, so it needs an admin to open it.
    run.declined.push({ key: raceKey, reason: "no admin builder" });
    return run;
  }

  const models = raceModels(await store.topModels(MODEL_RACE_MODELS));
  if (models.length < 2) {
    run.declined.push({ key: raceKey, reason: "not enough recent models" });
    return run;
  }

  const params: ModelRaceParams = {
    template: "model_race",
    scope: { kind: "global" },
    period: day,
    models,
  };
  const plan = planTemplateMarket({ params, audience: await store.builderCount() }, now);
  if (!plan.ok) {
    run.declined.push({ key: raceKey, reason: plan.error });
    return run;
  }
  await record(raceKey, plan.value, admin);

  return run;
}
