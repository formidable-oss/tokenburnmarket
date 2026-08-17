// Curved daily Credit mint (ADR 0004).
// One UTC day of a Builder's cost turns into Credits on a curve that flattens
// above a kink, so whales earn more but not proportionally more.

import type { TrustLevel } from "./trust.js";

/**
 * Version of the mint curve. Stored next to every minted amount so a future
 * parameter change stays auditable and never silently rewrites history.
 * Bump whenever any constant below changes.
 */
export const MINT_CURVE_VERSION = 1;

/** Cost (USD) below which the mint is linear, one Credit per dollar. */
export const MINT_KINK_USD = 20;

/** Multiplier on the square-root tail above the kink. */
export const MINT_TAIL_COEFFICIENT = 2;

/** Reported Usage mints at a discount because it carries no Receipt Stream. */
export const REPORTED_MINT_MULTIPLIER = 0.5;

/** One-off grant when a Builder signs up. */
export const SIGNUP_GRANT_CREDITS = 100;

/** Credits are tracked to this many decimals everywhere in the domain. */
export const CREDIT_DECIMALS = 4;

const CREDIT_SCALE = 10 ** CREDIT_DECIMALS;

/** Round to Credit precision, half away from zero. */
export function roundCredits(credits: number): number {
  return Math.round(credits * CREDIT_SCALE) / CREDIT_SCALE;
}

/** Round up to Credit precision. Used where the house must not lose a fraction. */
export function roundCreditsUp(credits: number): number {
  return Math.ceil(credits * CREDIT_SCALE) / CREDIT_SCALE;
}

/** Round down to Credit precision. Used where the Builder must not gain a fraction. */
export function roundCreditsDown(credits: number): number {
  return Math.floor(credits * CREDIT_SCALE) / CREDIT_SCALE;
}

/**
 * The raw curve: `mint = min(c, 20) + 2 * sqrt(max(c - 20, 0))`.
 *
 * Monotone non-decreasing over `c >= 0`, linear with slope 1 below the kink,
 * strictly concave above it. Negative costs clamp to 0.
 */
export function mintCurve(costUsd: number): number {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return 0;
  const linear = Math.min(costUsd, MINT_KINK_USD);
  const tail = MINT_TAIL_COEFFICIENT * Math.sqrt(Math.max(costUsd - MINT_KINK_USD, 0));
  return linear + tail;
}

/** How much of the curve a Trust Level is worth. Quarantined Usage mints nothing. */
export function mintMultiplierFor(trustLevel: TrustLevel): number {
  switch (trustLevel) {
    case "verified":
      return 1;
    case "reported":
      return REPORTED_MINT_MULTIPLIER;
    case "quarantined":
      return 0;
  }
}

export interface DailyMint {
  /** Credits to award for the day, rounded to Credit precision. */
  credits: number;
  /** Curve version that produced `credits`. Persist alongside the amount. */
  curveVersion: number;
  /** Trust multiplier applied to the raw curve. */
  multiplier: number;
}

/**
 * Mint for one Builder-day. `trustLevel` is the weakest Trust Level across the
 * day's Usage rows, so a single Quarantined row zeroes the day.
 *
 * Re-minting: the day is recomputed as usage grows, so callers award
 * `credits - alreadyMinted` and never claw back below zero.
 */
export function mintForDay(costUsd: number, trustLevel: TrustLevel): DailyMint {
  const multiplier = mintMultiplierFor(trustLevel);
  return {
    credits: roundCredits(mintCurve(costUsd) * multiplier),
    curveVersion: MINT_CURVE_VERSION,
    multiplier,
  };
}
