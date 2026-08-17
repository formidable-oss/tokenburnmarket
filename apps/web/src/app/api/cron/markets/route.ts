/*
  The weekly market job. Vercel Cron calls GET on Monday at 00:05 UTC (see
  vercel.json) with `Authorization: Bearer $CRON_SECRET`, five minutes into the
  week it opens Markets for; POST is here so a human can trigger the same run.

  Safe to call as often as anyone likes: every Market it opens is keyed by
  template, scope and week, and the key is unique.
*/
import { timingSafeEqual } from "node:crypto";
import { runAutoMarkets } from "@/lib/auto-markets";
import { drizzleAutoMarketStore } from "@/lib/auto-markets-store";

export const dynamic = "force-dynamic";
/** One Market per Community, each a handful of statements. Give a big site room. */
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // No secret configured means no cron, rather than an open endpoint.
  if (!secret) return false;
  const offered = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return offered.length === expected.length && timingSafeEqual(offered, expected);
}

async function handle(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const now = new Date();
  const result = await runAutoMarkets(drizzleAutoMarketStore(now), now);
  return Response.json(result, { status: 200 });
}

export const GET = handle;
export const POST = handle;
