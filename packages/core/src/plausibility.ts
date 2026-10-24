// Plausibility checks (ADR 0003, narrowed by ADR 0006, ADR 0007).
//
// Usage comes from user-owned transcript files, so it cannot be proven. Only a
// number that no real usage can produce holds a row back: a negative count, a
// day that has not started yet, or a cost no model's price can reach for those
// tokens. Those rows are Quarantined, and the server refuses them.
//
// Size proves nothing. A short prompt can ask for a long answer, and an API
// loop can run all day, so a heavy day counts in full. What a row can lose is
// the Verified badge: the Receipt Stream has to fit the tokens it stands for,
// or the row is Reported.

import type { TrustLevel } from "./trust";

export type PlausibilityCode =
  | "negative_counts"
  | "future_day"
  | "cost_above_any_price"
  | "receipt_stream_incoherent"
  | "receipt_stream_thin"
  | "no_receipt_stream";

export interface PlausibilityReason {
  code: PlausibilityCode;
  /** Short human sentence, safe to show in the admin queue. */
  message: string;
  observed?: number;
  limit?: number;
}

/** One (Device, day, provider, model) row as uploaded by a Sync. */
export interface UsageDayInput {
  /** UTC calendar day, `YYYY-MM-DD`. */
  day: string;
  provider: string;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
  /** Length of the Receipt Stream for this row. Zero means no stream. */
  receiptCount: number;
}

export interface PlausibilityLimits {
  /**
   * The most a million processed tokens of any kind can cost. The dearest model
   * in LiteLLM's price list charges $600 per million output tokens, so this
   * leaves room for priority and fast-mode pricing on top.
   */
  maxCostUsdPerMillionTokens: number;
  /**
   * A single receipt stands for one assistant message or billed turn. Outside
   * these bounds the stream does not fit the tokens, so it is not evidence.
   */
  maxOutputTokensPerReceipt: number;
  minOutputTokensPerReceipt: number;
}

export const DEFAULT_PLAUSIBILITY_LIMITS: PlausibilityLimits = {
  maxCostUsdPerMillionTokens: 2000,
  maxOutputTokensPerReceipt: 200_000,
  minOutputTokensPerReceipt: 1,
};

export interface PlausibilityContext {
  /** Evaluation time. A day that starts after it cannot have produced anything. */
  now: Date;
  /** Partial overrides on top of {@link DEFAULT_PLAUSIBILITY_LIMITS}. */
  limits?: Partial<PlausibilityLimits>;
}

export interface PlausibilityResult {
  trustLevel: TrustLevel;
  /** Empty only for a Verified row. Reported and Quarantined always explain themselves. */
  reasons: PlausibilityReason[];
}

export function resolvePlausibilityLimits(
  overrides?: Partial<PlausibilityLimits>,
): PlausibilityLimits {
  return { ...DEFAULT_PLAUSIBILITY_LIMITS, ...overrides };
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Start of a `YYYY-MM-DD` UTC day in epoch milliseconds, or NaN if malformed. */
function dayStartMs(day: string): number {
  if (!DAY_PATTERN.test(day)) return Number.NaN;
  return Date.parse(`${day}T00:00:00.000Z`);
}

/**
 * Judge one Usage row. Pure: same inputs, same verdict, so the Collector can
 * preview what the server will decide.
 */
export function checkPlausibility(
  row: UsageDayInput,
  context: PlausibilityContext,
): PlausibilityResult {
  const limits = resolvePlausibilityLimits(context.limits);

  const counts = [
    row.inputTokens,
    row.cachedInputTokens,
    row.cacheWriteTokens,
    row.outputTokens,
    row.reasoningTokens,
    row.costUsd,
    row.receiptCount,
  ];
  if (counts.some((n) => !Number.isFinite(n) || n < 0)) {
    return {
      trustLevel: "quarantined",
      reasons: [
        { code: "negative_counts", message: "Token counts and cost must be finite and non-negative." },
      ],
    };
  }

  const start = dayStartMs(row.day);
  if (Number.isNaN(start)) {
    return {
      trustLevel: "quarantined",
      reasons: [{ code: "future_day", message: "Day is not a valid UTC calendar day." }],
    };
  }
  if (start > context.now.getTime()) {
    return {
      trustLevel: "quarantined",
      reasons: [{ code: "future_day", message: "Day starts in the future." }],
    };
  }

  const processedTokens =
    row.inputTokens + row.cachedInputTokens + row.cacheWriteTokens + row.outputTokens + row.reasoningTokens;
  if (row.costUsd > (processedTokens / 1_000_000) * limits.maxCostUsdPerMillionTokens) {
    return {
      trustLevel: "quarantined",
      reasons: [
        {
          code: "cost_above_any_price",
          message: "Cost is higher than these tokens could cost at any model's price.",
          ...(processedTokens > 0 ? { observed: (row.costUsd / processedTokens) * 1_000_000 } : {}),
          limit: limits.maxCostUsdPerMillionTokens,
        },
      ],
    };
  }

  if (row.receiptCount === 0) {
    return {
      trustLevel: "reported",
      reasons: [
        {
          code: "no_receipt_stream",
          message: "This agent does not expose message identifiers, so Usage is self-reported.",
        },
      ],
    };
  }

  const producedTokens = row.outputTokens + row.reasoningTokens;
  const perReceipt = producedTokens / row.receiptCount;
  if (perReceipt > limits.maxOutputTokensPerReceipt) {
    return {
      trustLevel: "reported",
      reasons: [
        {
          code: "receipt_stream_incoherent",
          message:
            "More output tokens than the receipts can carry, so the stream is not counted as evidence.",
          observed: perReceipt,
          limit: limits.maxOutputTokensPerReceipt,
        },
      ],
    };
  }
  if (producedTokens > 0 && perReceipt < limits.minOutputTokensPerReceipt) {
    return {
      trustLevel: "reported",
      reasons: [
        {
          code: "receipt_stream_thin",
          message:
            "More receipts than the output tokens can account for, so the stream is not counted as evidence.",
          observed: perReceipt,
          limit: limits.minOutputTokensPerReceipt,
        },
      ],
    };
  }

  return { trustLevel: "verified", reasons: [] };
}
