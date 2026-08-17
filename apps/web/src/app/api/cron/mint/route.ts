/*
  The daily mint job. Vercel Cron calls GET at 01:00 UTC (see vercel.json) with
  `Authorization: Bearer $CRON_SECRET`; POST is here so a human can trigger the
  same run by hand.

  The job is safe to call as often as anyone likes: every write is keyed by a
  ledger ref, so a second call in the same minute mints nothing.
*/
import { timingSafeEqual } from "node:crypto";
import { runMint } from "@/lib/mint";
import { drizzleMintStore } from "@/lib/mint-store";

export const dynamic = "force-dynamic";
/** A backlog of Builder-days is a lot of small statements; give it room. */
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
  const result = await runMint(drizzleMintStore, new Date());
  return Response.json(result, { status: 200 });
}

export const GET = handle;
export const POST = handle;
