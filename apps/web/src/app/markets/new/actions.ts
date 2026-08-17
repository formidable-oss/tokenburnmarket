"use server";

/*
  Opening a Market from a template. The form sends a template and its
  parameters; everything a person could type is validated here and then handed
  to core, which decides the question, the Outcomes and the rules sentence. The
  page only ever picks; it never writes a label or a period of its own.

  Two permissions, checked in this file and nowhere else:
  a Community Market needs membership, and the owner's switch when it is off;
  a global or country Market needs an admin handle.
*/

import {
  MarketTemplateParamsSchema,
  MODEL_RACE_MODELS,
  type MarketTemplateParams,
} from "@tokenburnmarket/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/db";
import { markets, outcomes } from "@/db/schema";
import { isAdmin } from "@/lib/admin";
import { countryByCode } from "@/lib/countries";
import {
  builderCount,
  communitiesForMarkets,
  modelsInPlay,
  type CommunityForMarkets,
} from "@/lib/market-queries";
import {
  normalizePeriodChoice,
  periodForChoice,
  planTemplateMarket,
  raceModels,
  type MarketPlan,
} from "@/lib/market-templates";

export type CreateMarketState = {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: {
    community?: string;
    builder?: string;
    amount?: string;
    scope?: string;
    period?: string;
  };
};

const NOTHING_OPENED = "Nothing opened.";

function fail(message: string, fieldErrors?: CreateMarketState["fieldErrors"]): CreateMarketState {
  return { status: "error", message, fieldErrors };
}

/** The Market's amount, as typed. Cents are allowed; anything else is not a number. */
function normalizeAmount(input: string | null | undefined): number | null {
  const amount = Number((input ?? "").toString().trim());
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) return null;
  return Math.round(amount * 100) / 100;
}

/** Whether this Builder may open a Market in this Community right now. */
function mayCreateIn(
  community: CommunityForMarkets,
  builderId: string,
  admin: boolean,
): boolean {
  return community.membersCanCreate || community.ownerId === builderId || admin;
}

export async function createMarket(
  _previous: CreateMarketState,
  formData: FormData,
): Promise<CreateMarketState> {
  const session = await auth();
  if (!session?.user?.id) return fail("Sign in again to open a market.");
  const builderId = session.user.id;
  const admin = isAdmin(session.user.handle);

  const template = formData.get("template")?.toString() ?? "";
  const period = periodForChoice(
    normalizePeriodChoice(formData.get("period")?.toString()),
    new Date(),
  );

  let params: MarketTemplateParams;
  let audience: number;
  /** Only a Top Burner needs these: its Outcomes are not named in its params. */
  let members: CommunityForMarkets["members"] | undefined;

  if (template === "model_race") {
    if (!admin) return fail("Model races are opened by admins.");

    const where = formData.get("where")?.toString().trim() ?? "global";
    const country = where === "global" ? null : countryByCode(where);
    if (where !== "global" && !country) {
      return fail(NOTHING_OPENED, { scope: "Pick a country, or the whole world." });
    }

    const models = raceModels(await modelsInPlay(MODEL_RACE_MODELS, country?.code ?? null));
    params = {
      template: "model_race",
      scope: country
        ? { kind: "country", country: country.code, countryName: country.name }
        : { kind: "global" },
      period,
      models,
    };
    audience = await builderCount();
  } else {
    const communityId = formData.get("communityId")?.toString().trim() ?? "";
    // Reading the Builder's own Communities is the membership check.
    const mine = await communitiesForMarkets({ builderId });
    const community = mine.find((row) => row.id === communityId);
    if (!community) {
      return fail(NOTHING_OPENED, { community: "Pick a community you are in." });
    }
    if (!mayCreateIn(community, builderId, admin)) {
      return fail(NOTHING_OPENED, {
        community: "The owner of this community opens its markets.",
      });
    }

    const scope = {
      kind: "community" as const,
      communityId: community.id,
      communityName: community.name,
    };
    audience = community.members.length;
    const memberById = new Map(
      community.members.map((member) => [member.builderId, member] as const),
    );

    if (template === "top_burner") {
      params = { template: "top_burner", scope, period };
      members = community.members;
    } else if (template === "threshold") {
      const member = memberById.get(formData.get("builderId")?.toString() ?? "");
      const costUsd = normalizeAmount(formData.get("costUsd")?.toString());
      if (!member) return fail(NOTHING_OPENED, { builder: "Pick a member." });
      if (costUsd === null) return fail(NOTHING_OPENED, { amount: "Enter an amount in dollars." });
      params = { template: "threshold", scope, period, threshold: { ...member, costUsd } };
    } else if (template === "head_to_head") {
      const first = memberById.get(formData.get("builderA")?.toString() ?? "");
      const second = memberById.get(formData.get("builderB")?.toString() ?? "");
      if (!first || !second) return fail(NOTHING_OPENED, { builder: "Pick two members." });
      if (first.builderId === second.builderId) {
        return fail(NOTHING_OPENED, { builder: "Pick two different members." });
      }
      params = { template: "head_to_head", scope, period, pair: [first, second] };
    } else {
      return fail("That is not a template.");
    }
  }

  // Belt and braces: nothing reaches `params` that a resolver could not read back.
  const validated = MarketTemplateParamsSchema.safeParse(params);
  if (!validated.success) return fail("Those parameters do not make a market.");

  const plan = planTemplateMarket({ params: validated.data, members, audience });
  if (!plan.ok) return fail(NOTHING_OPENED, { period: plan.error });

  const id = await insertMarket(plan.value, builderId);
  revalidatePath("/markets");
  if (plan.value.communityId) revalidatePath(`/c/${plan.value.communityId}`);
  redirect(`/m/${id}`);
}

/** The Market and its book in one batch, which Neon runs as one transaction. */
async function insertMarket(plan: MarketPlan, createdBy: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.batch([
    db.insert(markets).values({
      id,
      scope: plan.scope,
      communityId: plan.communityId,
      country: plan.country,
      type: plan.type,
      question: plan.question,
      params: plan.params,
      b: plan.b,
      closesAt: plan.closesAt,
      resolvesAt: plan.resolvesAt,
      createdBy,
    }),
    ...plan.outcomes.map((outcome) =>
      db.insert(outcomes).values({
        marketId: id,
        label: outcome.label,
        ref: outcome.ref,
        sort: outcome.sort,
      }),
    ),
  ]);
  return id;
}
