/*
  Reviewing a Quarantined Usage row, expressed against a small store interface so
  the decisions are testable without a database, the same shape Sync and the mint
  use.

  Three rules:

  1. Only a Quarantined row is reviewable. A row that is already Verified or
     Reported is left alone, so a stale page or a second click changes nothing.
  2. Every decision is written down, including `keep`. The log is the record of
     who looked and what they thought, not the current state of the row.
  3. Clearing a row is upward only. The Builder-day is recomputed from the Usage
     rows and re-minted; the mint pays the difference and never claws back, so a
     Builder who spent the Credits of a day cannot go negative because of a
     later review.
*/
import type { TrustLevel } from "@tokenburnmarket/core";

/** What an Admin can decide about a Quarantined row. `keep` leaves it out. */
export type ReviewDecision = "verified" | "reported" | "keep";

export const REVIEW_DECISIONS: readonly ReviewDecision[] = ["verified", "reported", "keep"];

/** The longest note we store. Long enough for a sentence, short enough for a row. */
export const REVIEW_NOTE_MAX = 280;

export function isReviewDecision(value: unknown): value is ReviewDecision {
  return typeof value === "string" && (REVIEW_DECISIONS as readonly string[]).includes(value);
}

/** The Usage row's key: `usage_days` has no id of its own. */
export interface UsageKey {
  deviceId: string;
  day: string;
  provider: string;
  model: string;
}

/** The Trust Level a decision writes. `keep` writes the level the row already has. */
export function trustLevelForDecision(decision: ReviewDecision): TrustLevel {
  return decision === "keep" ? "quarantined" : decision;
}

export interface ReviewPlan {
  trustLevel: TrustLevel;
  /** Whether the row's Trust Level moves, which is also whether the day is recounted. */
  clears: boolean;
}

/**
 * What a decision does to a row at `current`. Null when the row is not up for
 * review: a Verified or Reported row has already been dealt with, and a second
 * decision on it must not silently demote anyone.
 */
export function planReview(current: TrustLevel, decision: ReviewDecision): ReviewPlan | null {
  if (current !== "quarantined") return null;
  const trustLevel = trustLevelForDecision(decision);
  return { trustLevel, clears: trustLevel !== "quarantined" };
}

export interface ReviewRecord extends UsageKey {
  decision: ReviewDecision;
  note: string | null;
  reviewerId: string;
}

export interface AdminReviewStore {
  /** The Builder and Trust Level of one Usage row, or null when it is gone. */
  usageRow(key: UsageKey): Promise<{ builderId: string; trustLevel: TrustLevel } | null>;
  recordReview(review: ReviewRecord): Promise<void>;
  setTrustLevel(key: UsageKey, trustLevel: TrustLevel): Promise<void>;
  /** Recompute the Builder-day rollup from its Usage rows. */
  recomputeBuilderDay(builderId: string, day: string): Promise<void>;
  /** Mint what the recomputed day is now worth. Returns the Credits added. */
  remintBuilderDay(builderId: string, day: string): Promise<number>;
}

export interface ReviewResult {
  /** False when the row was gone or no longer Quarantined; nothing was written. */
  applied: boolean;
  trustLevel: TrustLevel | null;
  /** Credits the re-mint added for the affected day. Zero unless the row cleared. */
  credits: number;
}

/** Trim a typed note to something storable, or null when it is blank. */
export function normalizeNote(input: string | null | undefined): string | null {
  const note = (input ?? "").trim().slice(0, REVIEW_NOTE_MAX);
  return note === "" ? null : note;
}

/**
 * Apply one decision. The caller has already checked that the reviewer is an
 * Admin.
 *
 * Writes are ordered so an interrupted review reads as a review that has not
 * happened yet: the log first, then the Trust Level, then the rollup, then the
 * mint. A repeat is harmless because step two takes the row out of the queue and
 * the mint is keyed by its ledger ref.
 */
export async function applyReview(
  store: AdminReviewStore,
  input: { key: UsageKey; decision: ReviewDecision; note: string | null; reviewerId: string },
): Promise<ReviewResult> {
  const row = await store.usageRow(input.key);
  if (!row) return { applied: false, trustLevel: null, credits: 0 };

  const plan = planReview(row.trustLevel, input.decision);
  if (!plan) return { applied: false, trustLevel: row.trustLevel, credits: 0 };

  await store.recordReview({
    ...input.key,
    decision: input.decision,
    note: input.note,
    reviewerId: input.reviewerId,
  });

  if (!plan.clears) return { applied: true, trustLevel: plan.trustLevel, credits: 0 };

  await store.setTrustLevel(input.key, plan.trustLevel);
  await store.recomputeBuilderDay(row.builderId, input.key.day);
  const credits = await store.remintBuilderDay(row.builderId, input.key.day);
  return { applied: true, trustLevel: plan.trustLevel, credits };
}
