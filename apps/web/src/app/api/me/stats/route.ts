/*
  GET /api/me/stats: what this machine's Builder has burned and holds.

  Three windows because that is what someone mid-session actually asks: today,
  this week, this month. Each one is the same rollup the profile page uses, over
  a different number of days, so the CLI and the site can never disagree.

  Quarantined rows are included in the count of what was held back, and excluded
  from the totals, exactly as they are on the profile.
*/
import { deviceCaller } from "@/lib/me-api";
import { builderUsage } from "@/lib/usage-queries";
import type { UsageSummary } from "@/lib/usage";

export const dynamic = "force-dynamic";

const WINDOWS = { today: 1, week: 7, month: 30 } as const;

function window(summary: UsageSummary) {
  return { costUsd: summary.totalCostUsd, tokens: summary.totalTokens };
}

export async function GET(request: Request) {
  const guard = await deviceCaller(request);
  if (!guard.ok) return guard.response;
  const { caller } = guard;

  const now = new Date();
  const [today, week, month] = await Promise.all(
    [WINDOWS.today, WINDOWS.week, WINDOWS.month].map((days) =>
      // The owner is asking about themselves, so held-back days are visible.
      builderUsage(caller.builderId, { days, now, includeQuarantined: true }),
    ),
  );

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
  });
}
