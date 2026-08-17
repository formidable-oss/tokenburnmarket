/*
  The review, against a store made of spies. Two things are pinned down here:
  which transitions are legal, and that clearing a row is followed by the rollup
  and the mint in that order. Getting the second wrong mints a day from stale
  numbers, which is Credits nobody can take back.
*/
import { describe, expect, it, vi } from "vitest";
import type { TrustLevel } from "@tokenburnmarket/core";
import {
  applyReview,
  isReviewDecision,
  normalizeNote,
  planReview,
  trustLevelForDecision,
  REVIEW_NOTE_MAX,
  type AdminReviewStore,
  type UsageKey,
} from "./admin-review";

const BUILDER = "11111111-1111-4111-8111-111111111111";
const REVIEWER = "22222222-2222-4222-8222-222222222222";
const KEY: UsageKey = {
  deviceId: "33333333-3333-4333-8333-333333333333",
  day: "2026-08-15",
  provider: "claude",
  model: "opus-5",
};

function spyStore(row: { builderId: string; trustLevel: TrustLevel } | null) {
  const calls: string[] = [];
  const store: AdminReviewStore = {
    usageRow: vi.fn(async () => row),
    recordReview: vi.fn(async () => {
      calls.push("record");
    }),
    setTrustLevel: vi.fn(async () => {
      calls.push("trust");
    }),
    recomputeBuilderDay: vi.fn(async () => {
      calls.push("rollup");
    }),
    remintBuilderDay: vi.fn(async () => {
      calls.push("mint");
      return 4.5;
    }),
  };
  return { store, calls };
}

describe("review decisions", () => {
  it("maps a decision to the trust level it writes", () => {
    expect(trustLevelForDecision("verified")).toBe("verified");
    expect(trustLevelForDecision("reported")).toBe("reported");
    expect(trustLevelForDecision("keep")).toBe("quarantined");
  });

  it("clears a quarantined row on either approval and not on keep", () => {
    expect(planReview("quarantined", "verified")).toEqual({ trustLevel: "verified", clears: true });
    expect(planReview("quarantined", "reported")).toEqual({ trustLevel: "reported", clears: true });
    expect(planReview("quarantined", "keep")).toEqual({
      trustLevel: "quarantined",
      clears: false,
    });
  });

  it("refuses to touch a row that is not quarantined", () => {
    expect(planReview("verified", "keep")).toBeNull();
    expect(planReview("reported", "verified")).toBeNull();
  });

  it("reads only the three decisions off a form", () => {
    expect(isReviewDecision("verified")).toBe(true);
    expect(isReviewDecision("quarantined")).toBe(false);
    expect(isReviewDecision(null)).toBe(false);
  });

  it("keeps a note short, or drops it when it is blank", () => {
    expect(normalizeNote("  looked fine  ")).toBe("looked fine");
    expect(normalizeNote("   ")).toBeNull();
    expect(normalizeNote(undefined)).toBeNull();
    expect(normalizeNote("x".repeat(400))?.length).toBe(REVIEW_NOTE_MAX);
  });
});

describe("applyReview", () => {
  it("approving records the decision, then recounts the day, then mints", async () => {
    const { store, calls } = spyStore({ builderId: BUILDER, trustLevel: "quarantined" });

    const result = await applyReview(store, {
      key: KEY,
      decision: "verified",
      note: null,
      reviewerId: REVIEWER,
    });

    expect(result).toEqual({ applied: true, trustLevel: "verified", credits: 4.5 });
    expect(calls).toEqual(["record", "trust", "rollup", "mint"]);
    expect(store.setTrustLevel).toHaveBeenCalledWith(KEY, "verified");
    expect(store.recomputeBuilderDay).toHaveBeenCalledWith(BUILDER, KEY.day);
    expect(store.remintBuilderDay).toHaveBeenCalledWith(BUILDER, KEY.day);
  });

  it("approving as reported clears the row at the discounted trust level", async () => {
    const { store } = spyStore({ builderId: BUILDER, trustLevel: "quarantined" });

    const result = await applyReview(store, {
      key: KEY,
      decision: "reported",
      note: "no receipt stream, agent cannot be read",
      reviewerId: REVIEWER,
    });

    expect(result.trustLevel).toBe("reported");
    expect(store.setTrustLevel).toHaveBeenCalledWith(KEY, "reported");
    expect(store.remintBuilderDay).toHaveBeenCalledOnce();
  });

  it("keeping the row writes the note and leaves the day alone", async () => {
    const { store, calls } = spyStore({ builderId: BUILDER, trustLevel: "quarantined" });

    const result = await applyReview(store, {
      key: KEY,
      decision: "keep",
      note: "two devices, same transcripts",
      reviewerId: REVIEWER,
    });

    expect(result).toEqual({ applied: true, trustLevel: "quarantined", credits: 0 });
    expect(calls).toEqual(["record"]);
    expect(store.recomputeBuilderDay).not.toHaveBeenCalled();
    expect(store.remintBuilderDay).not.toHaveBeenCalled();
  });

  it("writes nothing for a row someone else already cleared", async () => {
    const { store, calls } = spyStore({ builderId: BUILDER, trustLevel: "verified" });

    const result = await applyReview(store, {
      key: KEY,
      decision: "verified",
      note: null,
      reviewerId: REVIEWER,
    });

    expect(result.applied).toBe(false);
    expect(calls).toEqual([]);
  });

  it("writes nothing for a row that is gone", async () => {
    const { store, calls } = spyStore(null);

    const result = await applyReview(store, {
      key: KEY,
      decision: "verified",
      note: null,
      reviewerId: REVIEWER,
    });

    expect(result).toEqual({ applied: false, trustLevel: null, credits: 0 });
    expect(calls).toEqual([]);
  });
});
