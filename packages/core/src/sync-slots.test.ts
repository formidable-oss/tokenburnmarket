import { describe, expect, it } from "vitest";
import { SYNC_SLOT_HOURS, SYNC_SLOT_TIMES, SYNC_WINDOW_MS, inSyncWindow, nextSyncSlot, syncSlotStart } from "./sync-slots";

const at = (iso: string) => new Date(iso);

describe("sync slots", () => {
  it("starts slots every six hours from midnight UTC", () => {
    expect(syncSlotStart(at("2026-10-21T13:37:00Z")).toISOString()).toBe("2026-10-21T12:00:00.000Z");
    expect(syncSlotStart(at("2026-10-21T00:00:00Z")).toISOString()).toBe("2026-10-21T00:00:00.000Z");
    expect(syncSlotStart(at("2026-10-21T23:59:59Z")).toISOString()).toBe("2026-10-21T18:00:00.000Z");
  });

  it("names the next boundary strictly after now, across midnight", () => {
    expect(nextSyncSlot(at("2026-10-21T13:37:00Z")).toISOString()).toBe("2026-10-21T18:00:00.000Z");
    expect(nextSyncSlot(at("2026-10-21T12:00:00Z")).toISOString()).toBe("2026-10-21T18:00:00.000Z");
    expect(nextSyncSlot(at("2026-10-21T19:00:00Z")).toISOString()).toBe("2026-10-22T00:00:00.000Z");
  });

  it("spells out the same slots it computes", () => {
    const starts = Array.from({ length: 24 / SYNC_SLOT_HOURS }, (_, i) =>
      `${String(i * SYNC_SLOT_HOURS).padStart(2, "0")}:00`,
    );
    expect(SYNC_SLOT_TIMES).toBe(`${starts.slice(0, -1).join(", ")} and ${starts.at(-1)} UTC`);
  });

  it("is open for the first fifteen minutes of a slot only", () => {
    expect(inSyncWindow(at("2026-10-21T06:00:00Z"))).toBe(true);
    expect(inSyncWindow(at("2026-10-21T06:14:59Z"))).toBe(true);
    expect(inSyncWindow(new Date(at("2026-10-21T06:00:00Z").getTime() + SYNC_WINDOW_MS))).toBe(false);
    expect(inSyncWindow(at("2026-10-21T05:59:59Z"))).toBe(false);
  });
});
