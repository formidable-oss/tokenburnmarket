/*
  The daily mint job. Vercel Cron calls GET at 00:20 UTC (see vercel.json) with
  `Authorization: Bearer $CRON_SECRET`; POST is here so a human can trigger the
  same run by hand. It runs just after the midnight Sync Slot closes, so it
  shares that slot's database wake-up (ADR 0005), and it prunes Receipts that
  have aged out of retention while it is there. Before it mints, it puts back
  Usage that retired checks had Quarantined (ADR 0006) and rebuilds any
  Builder-day whose totals no longer match its Usage, so those days are minted
  on what they are worth in the same run.

  The job is safe to call as often as anyone likes: every write is keyed by a
  ledger ref, so a second call in the same minute mints nothing.
*/
import { timingSafeEqual } from "node:crypto";
import { runMint } from "@/lib/mint";
import { drizzleMintStore } from "@/lib/mint-store";
import { reconcileBuilderDays, receiptCutoffDay, restoreRetiredQuarantines } from "@/lib/sync";
import { drizzleSyncStore, pruneReceipts } from "@/lib/sync-store";

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
  const now = new Date();
  const usageRestored = await restoreRetiredQuarantines(drizzleSyncStore, now);
  const daysRebuilt = await reconcileBuilderDays(drizzleSyncStore);
  const result = await runMint(drizzleMintStore, now);
  const receiptsPruned = await pruneReceipts(receiptCutoffDay(now));
  return Response.json({ ...result, usageRestored, daysRebuilt, receiptsPruned }, { status: 200 });
}

export const GET = handle;
export const POST = handle;
