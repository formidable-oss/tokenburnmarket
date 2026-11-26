/*
  GET /api/me/stats: what this machine's Builder has burned and holds.

  Three windows because that is what someone mid-session actually asks: today,
  this week, this month. Each one is the same rollup the profile page uses, over
  a different number of days, so the CLI and the site can never disagree.

  Quarantined rows are included in the count of what was held back, and excluded
  from the totals, exactly as they are on the profile.
*/
import { betRecord } from "@/lib/bets";
import { betsFor } from "@/lib/market-queries";
import { deviceCaller } from "@/lib/me-api";
import { builderUsage } from "@/lib/usage-queries";
import type { UsageSummary } from "@/lib/usage";

export const dynamic = "force-dynamic";

const WINDOWS = { today: 1, week: 7, month: 30 } as const;

/** How many bets the agent is told about by name. */
const RECENT_BETS = 5;

function window(summary: UsageSummary) {
  return { costUsd: summary.totalCostUsd, tokens: summary.totalTokens };
}

export async function GET(request: Request) {
  const guard = await deviceCaller(request);
  if (!guard.ok) return guard.response;
  const { caller } = guard;

  const now = new Date();
  const [[today, week, month], bets] = await Promise.all([
    Promise.all(
      [WINDOWS.today, WINDOWS.week, WINDOWS.month].map((days) =>
        // The owner is asking about themselves, so held-back days are visible.
        builderUsage(caller.builderId, { days, now, includeQuarantined: true }),
      ),
    ),
    betsFor(caller.builderId, { limit: 200, now }),
  ]);

  /*
    Trust is reported per provider, not as one badge: a Builder can have a
    verified Claude Code stream and a reported one from somewhere else, and
    flattening that would overstate the weaker half.
  */
  const trust = month!.byProvider.map((group) => ({
    provider: group.provider,
    level: group.trustLevel,
  }));

  return Response.json({
    handle: caller.handle,
    credits: { balance: caller.creditBalance },
    usage: {
      today: window(today!),
      week: window(week!),
      month: window(month!),
    },
    trust,
    quarantinedDays: month!.quarantined.length,
    /*
      So an agent that placed a bet can say how it went. The record covers every
      settled bet; `recent` is the newest few, with what an open one pays if its
      biggest holding wins.
    */
    bets: {
      record: betRecord(bets),
      recent: bets.slice(0, RECENT_BETS).map((bet) => {
        const top = bet.holdings.reduce<(typeof bet.holdings)[number] | null>(
          (best, holding) => (best === null || holding.shares > best.shares ? holding : best),
          null,
        );
        return {
          marketId: bet.marketId,
          question: bet.question,
          state: bet.state,
          staked: bet.bought,
          net: bet.net,
          winner: bet.winnerLabel,
          paysIfWins: bet.net === null && top ? { label: top.label, credits: top.shares } : null,
        };
      }),
    },
  });
}
