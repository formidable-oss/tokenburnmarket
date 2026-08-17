/*
  The daily Credit mint (ADR 0004), expressed against a small store interface so
  the decisions are testable without a database, the same shape Sync uses.

  Three rules hold the whole thing together:

  1. A day is only minted once it has closed and sat still for a late-sync
     buffer, so a Collector that uploads a day late still gets counted.
  2. The mint is a target, not an increment: the curve is recomputed from the
     Builder-day and the ledger receives the difference. Usage that grows mints
     more; nothing ever claws back below what was already awarded.
  3. Every ledger row carries a ref, and the ref is unique per Builder. Re-runs
     and overlapping runs land on the same state instead of double-minting.
*/
import { SIGNUP_GRANT_CREDITS, mintForDay, roundCredits } from "@tokenburnmarket/core";
import type { TrustLevel } from "@tokenburnmarket/core";

/** How long after a UTC day closes the mint waits for late Syncs. */
export const MINT_BUFFER_HOURS = 24;

/** The ref every signup grant carries. Constant, so a Builder can only ever have one. */
export const SIGNUP_REF = "grant";

const HOUR_MS = 60 * 60 * 1000;

/**
 * The newest UTC day that may be minted at `now`: a day closes at the following
 * midnight UTC and is minted `MINT_BUFFER_HOURS` after that.
 */
export function lastMintableDay(now: Date): string {
  const settled = now.getTime() - (24 + MINT_BUFFER_HOURS) * HOUR_MS;
  return new Date(settled).toISOString().slice(0, 10);
}

/** The ledger ref for one mint of one day. The revision is what makes a top-up distinct. */
export function mintRef(day: string, revision: number): string {
  return `${day}:${revision}`;
}

/** A Builder-day as the mint reads it. */
export interface MintCandidate {
  builderId: string;
  day: string;
  costUsd: number;
  /** Weakest Trust Level of the day: Reported mints at half, Quarantined at zero. */
  trustLevelMin: TrustLevel;
  /** Credits already awarded for this day. */
  creditsMinted: number;
  /** How many times the day has been minted so far. */
  mintRevision: number;
}

/** One ledger row plus the Builder-day state it advances. */
export interface MintWrite {
  builderId: string;
  day: string;
  /** Credits this row adds. Always greater than zero. */
  delta: number;
  /** What the day is worth in total once this row lands. */
  credits: number;
  curveVersion: number;
  /** Revision being written; the Builder-day moves to `revision + 1`. */
  revision: number;
  refId: string;
}

/**
 * What a candidate day still owes, or null when it is settled.
 *
 * A day whose Usage shrank, or whose Trust Level dropped to Quarantined after
 * it was minted, returns null: Credits already spent on a Market cannot be
 * unspent, so the correction is a future admin reversal, not a negative mint.
 */
export function planMint(candidate: MintCandidate): MintWrite | null {
  const { credits, curveVersion } = mintForDay(candidate.costUsd, candidate.trustLevelMin);
  const delta = roundCredits(credits - candidate.creditsMinted);
  if (delta <= 0) return null;
  return {
    builderId: candidate.builderId,
    day: candidate.day,
    delta,
    credits,
    curveVersion,
    revision: candidate.mintRevision,
    refId: mintRef(candidate.day, candidate.mintRevision),
  };
}

export interface MintStore {
  /**
   * Builder-days up to and including `throughDay` that may still owe Credits.
   * Over-fetching is fine and under-fetching is not: `planMint` is the judge.
   */
  candidates(throughDay: string): Promise<MintCandidate[]>;
  /**
   * One Builder-day, whatever state it is in, or null when there is no such row.
   * The mint runs over `candidates`; this is for the admin path, which knows
   * exactly which day it just changed and should not scan the whole table.
   */
  candidateFor(builderId: string, day: string): Promise<MintCandidate | null>;
  /**
   * Write one mint: the ledger row, then the Builder-day it advances. Returns
   * false when the ledger row was already there, which is how a second runner
   * finds out it lost the race. The Builder-day update is applied either way,
   * so a run interrupted between the two statements is repaired by the next.
   */
  recordMint(write: MintWrite): Promise<boolean>;
  /** Recompute `builders.credit_balance` from the ledger for these Builders. */
  refreshBalances(builderIds: readonly string[]): Promise<void>;
  /** Insert the signup grant if this Builder has never had one. Returns false if they had. */
  grantSignup(builderId: string, credits: number): Promise<boolean>;
}

export interface MintRunResult {
  /** Newest day this run considered. */
  throughDay: string;
  /** Builder-days that received Credits. */
  minted: number;
  /** Credits awarded by this run. */
  credits: number;
  /** Builders whose balance moved. */
  builders: number;
}

/** Mint every closed Builder-day that is short of what the curve says it is worth. */
export async function runMint(store: MintStore, now: Date): Promise<MintRunResult> {
  const throughDay = lastMintableDay(now);
  const candidates = await store.candidates(throughDay);

  const touched = new Set<string>();
  let minted = 0;
  let credits = 0;

  for (const candidate of candidates) {
    const write = planMint(candidate);
    if (!write) continue;
    const inserted = await store.recordMint(write);
    if (!inserted) continue;
    minted += 1;
    credits = roundCredits(credits + write.delta);
    touched.add(write.builderId);
  }

  if (touched.size > 0) await store.refreshBalances([...touched]);
  return { throughDay, minted, credits, builders: touched.size };
}

/**
 * Mint one Builder-day now, for a day whose Usage just changed under it: an
 * Admin clearing a Quarantined row is the only caller today.
 *
 * Same three rules as the cron, so it can be called as often as anyone likes:
 * a day that has not closed and settled is left to the cron, the curve decides
 * the target, and the ledger ref makes a repeat a no-op. Returns the Credits
 * this call added, which is zero whenever the day was already worth as much.
 */
export async function remintBuilderDay(
  store: MintStore,
  builderId: string,
  day: string,
  now: Date,
): Promise<number> {
  if (day > lastMintableDay(now)) return 0;
  const candidate = await store.candidateFor(builderId, day);
  if (!candidate) return 0;

  const write = planMint(candidate);
  if (!write) return 0;
  const inserted = await store.recordMint(write);
  if (!inserted) return 0;

  await store.refreshBalances([builderId]);
  return write.delta;
}

/**
 * The one-off grant that gives a new Builder something to bet with. Called on
 * every sign-in because it is cheaper to ask than to remember, and the ledger
 * ref makes the second ask a no-op.
 */
export async function grantSignupCredits(store: MintStore, builderId: string): Promise<boolean> {
  const granted = await store.grantSignup(builderId, SIGNUP_GRANT_CREDITS);
  if (granted) await store.refreshBalances([builderId]);
  return granted;
}
