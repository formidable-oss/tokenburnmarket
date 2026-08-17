"use server";

import { lmsrLiquidityForMembers } from "@tokenburnmarket/core";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/db";
import { markets, memberships, outcomes } from "@/db/schema";
import { builderCount, memberCount } from "@/lib/market-queries";
import {
  MAX_OUTCOMES,
  normalizeClosesAt,
  normalizeOutcomeLabels,
  normalizeQuestion,
  resolutionTimeFor,
} from "@/lib/markets";

/*
  The generic Market creation used to exercise trading. Ticket #10 replaces it
  with a form per template that fills `params` and the Outcome `ref`s a resolver
  can read; until then a Market opened here carries the `top_burner` type as a
  placeholder and settles no more automatically than its Outcomes allow.
*/

export type CreateMarketState = {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: { question?: string; outcomes?: string; closesAt?: string; scope?: string };
};

export async function createMarket(
  _previous: CreateMarketState,
  formData: FormData,
): Promise<CreateMarketState> {
  const session = await auth();
  if (!session?.user?.id) return { status: "error", message: "Sign in again to open a market." };
  const builderId = session.user.id;

  const question = normalizeQuestion(formData.get("question")?.toString());
  const labels = normalizeOutcomeLabels(
    Array.from({ length: MAX_OUTCOMES }, (_, index) => formData.get(`outcome-${index}`)?.toString()),
  );
  const closesAt = normalizeClosesAt(formData.get("closesAt")?.toString());

  // Empty means global; anything else has to be a Community the Builder is in.
  const communityId = formData.get("communityId")?.toString().trim() ?? "";

  if (!question.ok || !labels.ok || !closesAt.ok) {
    return {
      status: "error",
      message: "Nothing opened.",
      fieldErrors: {
        question: question.ok ? undefined : question.error,
        outcomes: labels.ok ? undefined : labels.error,
        closesAt: closesAt.ok ? undefined : closesAt.error,
      },
    };
  }

  if (communityId !== "") {
    const [membership] = await db
      .select({ builderId: memberships.builderId })
      .from(memberships)
      .where(
        and(eq(memberships.communityId, communityId), eq(memberships.builderId, builderId)),
      )
      .limit(1);
    if (!membership) {
      return {
        status: "error",
        message: "Nothing opened.",
        fieldErrors: { scope: "You are not in that community." },
      };
    }
  }

  /*
    Liquidity is fixed at creation from the size of the audience (ADR 0002), and
    never moves afterwards: changing `b` would reprice every Position held.
  */
  const members = communityId === "" ? await builderCount() : await memberCount(communityId);
  const b = lmsrLiquidityForMembers(members);

  const id = crypto.randomUUID();
  await db.batch([
    db.insert(markets).values({
      id,
      scope: communityId === "" ? "global" : "community",
      communityId: communityId === "" ? null : communityId,
      type: "top_burner",
      question: question.value,
      params: {
        rules: `Whichever outcome is true when this settles pays 1 credit a share. Nothing else pays.`,
      },
      b,
      closesAt: closesAt.value,
      resolvesAt: resolutionTimeFor(closesAt.value),
      createdBy: builderId,
    }),
    ...labels.value.map((label, index) =>
      db.insert(outcomes).values({ marketId: id, label, sort: index }),
    ),
  ]);

  revalidatePath("/markets");
  redirect(`/m/${id}`);
}
