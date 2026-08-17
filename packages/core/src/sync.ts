// The Sync payload: one signed upload from a Device (CONTEXT.md, ADR 0003).
//
// The schema is the contract between the Collector and `POST /api/sync`. It is
// strict on purpose: unknown keys are rejected, because the signature covers
// the canonical JSON of the whole payload and a silently dropped field would
// verify against bytes the server never read.

import { z } from "zod";
import { canonicalJson } from "./canonical-json";
import type { UsageDayInput } from "./plausibility";
import { signPayload, verifyPayload } from "./signing";

/** Bumped when the payload shape changes in a way old Collectors cannot produce. */
export const SYNC_PAYLOAD_VERSION = 1;

/** Caps that keep one upload bounded. Beyond these the Collector must page. */
export const MAX_SYNC_DAYS = 400;
export const MAX_RECEIPTS_PER_DAY = 50_000;

const tokenCount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** Lowercase sha256 hex of a per-message identifier. Never message content. */
export const ReceiptHashSchema = z.string().regex(/^[0-9a-f]{64}$/, "expected a sha256 hex digest");

/** UTC calendar day, `YYYY-MM-DD`. */
export const UtcDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected a YYYY-MM-DD UTC day")
  .refine((day) => !Number.isNaN(Date.parse(`${day}T00:00:00.000Z`)), "not a real calendar day");

export const SyncDaySchema = z
  .object({
    day: UtcDaySchema,
    provider: z.string().min(1).max(64),
    model: z.string().min(1).max(128),
    inputTokens: tokenCount,
    cachedInputTokens: tokenCount,
    cacheWriteTokens: tokenCount,
    outputTokens: tokenCount,
    reasoningTokens: tokenCount,
    costUsd: z.number().min(0).max(1_000_000).finite(),
    /** Empty means this agent exposes no message identifiers, so the row is Reported. */
    receipts: z.array(ReceiptHashSchema).max(MAX_RECEIPTS_PER_DAY),
  })
  .strict();

export const SyncPayloadSchema = z
  .object({
    version: z.literal(SYNC_PAYLOAD_VERSION),
    deviceId: z.uuid(),
    /** ISO-8601 instant in UTC, e.g. `2026-08-17T09:30:00.000Z`. Replay window lives server-side. */
    sentAt: z.iso.datetime(),
    days: z.array(SyncDaySchema).min(1).max(MAX_SYNC_DAYS),
  })
  .strict();

/** Transport wrapper. A body without a signature is not a Sync. */
export const SignedSyncSchema = z
  .object({
    payload: SyncPayloadSchema,
    /** Base64 raw Ed25519 signature over `canonicalJson(payload)`. */
    signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/, "expected a base64 Ed25519 signature"),
  })
  .strict();

export type SyncDay = z.infer<typeof SyncDaySchema>;
export type SyncPayload = z.infer<typeof SyncPayloadSchema>;
export type SignedSync = z.infer<typeof SignedSyncSchema>;

/** Bytes a Device signs. Exposed so the CLI and the server never drift apart. */
export function syncSigningInput(payload: SyncPayload): string {
  return canonicalJson(payload);
}

export type SyncVerification =
  | { ok: true; payload: SyncPayload }
  | { ok: false; error: "malformed" | "bad_signature"; issues?: z.core.$ZodIssue[] };

/**
 * Parse an untrusted request body and check its signature against the Device's
 * public key. `malformed` covers anything the schema rejects, including a body
 * with no signature; `bad_signature` means well-formed but not from this Device.
 */
export async function verifySyncBody(
  publicKeyBase64: string,
  body: unknown,
): Promise<SyncVerification> {
  const parsed = SignedSyncSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: "malformed", issues: parsed.error.issues };

  const valid = await verifyPayload(publicKeyBase64, parsed.data.payload, parsed.data.signature);
  if (!valid) return { ok: false, error: "bad_signature" };

  return { ok: true, payload: parsed.data.payload };
}

/** Sign a payload and wrap it for transport. The Collector's half of the contract. */
export async function createSignedSync(
  privateKeyBase64: string,
  payload: SyncPayload,
): Promise<SignedSync> {
  return { payload, signature: await signPayload(privateKeyBase64, payload) };
}

/** Adapt one uploaded day to the plausibility check's input shape. */
export function usageDayInputFromSyncDay(day: SyncDay): UsageDayInput {
  const { receipts, ...rest } = day;
  return { ...rest, receiptCount: receipts.length };
}
