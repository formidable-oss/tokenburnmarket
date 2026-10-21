// Sync Slots (ADR 0005): the shared windows automatic Syncs land in.
//
// The database is billed for every minute it is awake and sleeps after five
// idle ones, so what costs money is how many separate moments something talks
// to it, not how much is said. Every Collector therefore syncs on its own in
// the same few windows a day, whoever and wherever it is, and the daily jobs
// run inside the first one. A Sync the person asked for (connect, `sync`, the
// MCP tool) is never held to a window.

/** Slots start every this many hours, on the hour, from 00:00 UTC. */
export const SYNC_SLOT_HOURS = 6;

/** The slot starts as a person reads them. Kept beside the hours it spells out. */
export const SYNC_SLOT_TIMES = "00:00, 06:00, 12:00 and 18:00 UTC";

/**
 * How long a slot stays open for automatic Syncs. Wide enough that a daemon on
 * the old fifteen-minute timer still lands in it once; Collectors that know
 * the slots aim for its first few minutes.
 */
export const SYNC_WINDOW_MS = 15 * 60_000;

/** How far into a window a Collector may spread its start, so a slot is not one spike. */
export const SYNC_JITTER_MS = 5 * 60_000;

/** The header a Collector sends to say why it is syncing. */
export const SYNC_TRIGGER_HEADER = "x-sync-trigger";

/** `manual` is a person asking; `scheduled` is a Collector on its own. */
export type SyncTrigger = "manual" | "scheduled";

const SLOT_MS = SYNC_SLOT_HOURS * 3_600_000;

/** The start of the slot `now` falls in: the latest slot boundary at or before it. */
export function syncSlotStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / SLOT_MS) * SLOT_MS);
}

/** The first slot boundary strictly after `now`. */
export function nextSyncSlot(now: Date): Date {
  return new Date(syncSlotStart(now).getTime() + SLOT_MS);
}

/** Whether an automatic Sync sent at `now` is inside a slot's window. */
export function inSyncWindow(now: Date): boolean {
  return now.getTime() - syncSlotStart(now).getTime() < SYNC_WINDOW_MS;
}
