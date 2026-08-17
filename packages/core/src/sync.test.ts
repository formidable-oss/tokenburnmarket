import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkPlausibility } from "./plausibility";
import { generateDeviceKeyPair, signPayload, verifyPayload } from "./signing";
import {
  SYNC_PAYLOAD_VERSION,
  type SyncPayload,
  SyncPayloadSchema,
  createSignedSync,
  syncSigningInput,
  usageDayInputFromSyncDay,
  verifySyncBody,
} from "./sync";

const DEVICE_ID = "6f1c0b1e-2b7a-4d6f-9a4a-1f2b3c4d5e6f";

function payload(overrides: Partial<SyncPayload> = {}): SyncPayload {
  return {
    version: SYNC_PAYLOAD_VERSION,
    deviceId: DEVICE_ID,
    sentAt: "2026-08-17T12:00:00.000Z",
    days: [
      {
        day: "2026-08-16",
        provider: "anthropic",
        model: "claude-sonnet-4-5-20250929",
        inputTokens: 12_000,
        cachedInputTokens: 4_200_000,
        cacheWriteTokens: 180_000,
        outputTokens: 240_000,
        reasoningTokens: 0,
        costUsd: 42.5,
        receipts: ["a".repeat(64), "b".repeat(64)],
      },
    ],
    ...overrides,
  };
}

describe("SyncPayloadSchema", () => {
  it("accepts a well-formed payload", () => {
    expect(SyncPayloadSchema.safeParse(payload()).success).toBe(true);
  });

  it("rejects malformed payloads", () => {
    const bad: unknown[] = [
      null,
      "not an object",
      { ...payload(), deviceId: "nope" },
      { ...payload(), sentAt: "17 Aug 2026" },
      { ...payload(), version: 99 },
      { ...payload(), days: [] },
      { ...payload(), extra: true },
      { ...payload(), days: [{ ...payload().days[0], day: "2026-8-16" }] },
      { ...payload(), days: [{ ...payload().days[0], outputTokens: -1 }] },
      { ...payload(), days: [{ ...payload().days[0], outputTokens: 1.5 }] },
      { ...payload(), days: [{ ...payload().days[0], costUsd: -0.01 }] },
      { ...payload(), days: [{ ...payload().days[0], receipts: ["short"] }] },
      { ...payload(), days: [{ ...payload().days[0], receipts: ["A".repeat(64)] }] },
      { ...payload(), days: [{ ...payload().days[0], unknownField: 1 }] },
    ];
    for (const body of bad) {
      expect(SyncPayloadSchema.safeParse(body).success, JSON.stringify(body)?.slice(0, 80)).toBe(
        false,
      );
    }
  });

  it("allows an empty Receipt Stream, which the checks read as Reported", () => {
    const body = payload({ days: [{ ...payload().days[0], receipts: [] }] });
    expect(SyncPayloadSchema.safeParse(body).success).toBe(true);
    const row = usageDayInputFromSyncDay(body.days[0]);
    expect(row.receiptCount).toBe(0);
    expect(checkPlausibility(row, { now: new Date("2026-08-17T12:00:00Z") }).trustLevel).toBe(
      "reported",
    );
  });
});

describe("signing a Sync", () => {
  it("signs canonical bytes, so the Collector and the server agree on the message", () => {
    const reordered = {
      days: payload().days,
      sentAt: payload().sentAt,
      deviceId: payload().deviceId,
      version: payload().version,
    } as SyncPayload;
    expect(syncSigningInput(payload())).toBe(syncSigningInput(reordered));
    expect(syncSigningInput(payload()).startsWith('{"days":')).toBe(true);
  });

  it("round-trips sign then verify", async () => {
    const keys = await generateDeviceKeyPair();
    const signed = await createSignedSync(keys.privateKey, payload());
    await expect(verifySyncBody(keys.publicKey, signed)).resolves.toEqual({
      ok: true,
      payload: payload(),
    });
  });

  it("verifies regardless of key order in the transmitted JSON", async () => {
    const keys = await generateDeviceKeyPair();
    const signed = await createSignedSync(keys.privateKey, payload());
    // Re-order top-level keys the way a different JSON serialiser might.
    const reordered = {
      signature: signed.signature,
      payload: {
        days: signed.payload.days,
        sentAt: signed.payload.sentAt,
        deviceId: signed.payload.deviceId,
        version: signed.payload.version,
      },
    };
    const result = await verifySyncBody(keys.publicKey, reordered);
    expect(result.ok).toBe(true);
  });

  it("rejects an unsigned body", async () => {
    const keys = await generateDeviceKeyPair();
    const result = await verifySyncBody(keys.publicKey, { payload: payload() });
    expect(result).toMatchObject({ ok: false, error: "malformed" });
  });

  it("rejects a tampered payload", async () => {
    const keys = await generateDeviceKeyPair();
    const signed = await createSignedSync(keys.privateKey, payload());
    signed.payload.days[0].costUsd = 9_999;
    await expect(verifySyncBody(keys.publicKey, signed)).resolves.toEqual({
      ok: false,
      error: "bad_signature",
    });
  });

  it("rejects a signature from another Device", async () => {
    const mine = await generateDeviceKeyPair();
    const theirs = await generateDeviceKeyPair();
    const signed = await createSignedSync(theirs.privateKey, payload());
    await expect(verifySyncBody(mine.publicKey, signed)).resolves.toEqual({
      ok: false,
      error: "bad_signature",
    });
  });

  it("returns false rather than throwing for an unusable public key", async () => {
    const keys = await generateDeviceKeyPair();
    const signature = await signPayload(keys.privateKey, { a: 1 });
    await expect(verifyPayload("not-a-key", { a: 1 }, signature)).resolves.toBe(false);
  });

  it("round-trips arbitrary JSON payloads", async () => {
    const keys = await generateDeviceKeyPair();
    await fc.assert(
      fc.asyncProperty(fc.jsonValue(), async (value) => {
        const signature = await signPayload(keys.privateKey, value);
        expect(await verifyPayload(keys.publicKey, value, signature)).toBe(true);
      }),
      { numRuns: 25 },
    );
  });
});
