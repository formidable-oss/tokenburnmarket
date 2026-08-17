/*
  The resolution job. Vercel Cron calls GET every ten minutes (see vercel.json)
  with `Authorization: Bearer $CRON_SECRET`; POST is here so a human can trigger
  the same run by hand.

  Ten minutes is the resolution of "closed" a trader sees: a Market stops taking
  trades on its close time whatever the cron does (the trade path checks the
  clock), and this job is what makes the page say so.

  Safe to call as often as anyone likes: every payout and every refund is keyed
  by a ledger ref, so a second call in the same minute moves no Credits.
*/
import { timingSafeEqual } from "node:crypto";
import { runResolution } from "@/lib/resolution";
import { drizzleResolutionStore } from "@/lib/resolution-store";

export const dynamic = "force-dynamic";
/** A backlog of due Markets is a lot of small transactions; give it room. */
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
  const result = await runResolution(drizzleResolutionStore, new Date());
  return Response.json(result, { status: 200 });
}

export const GET = handle;
export const POST = handle;
