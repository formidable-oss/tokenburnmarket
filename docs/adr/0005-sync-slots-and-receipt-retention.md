# ADR 0005 — Sync Slots and Receipt retention, so the database sleeps

Status: accepted · 2026-10-21

## Context
Neon bills compute for every minute the database is awake and suspends it after five idle minutes. In October 2026 it was awake 91% of the time at 1 CU, about $48 of a month's bill for 21 Builders. Nothing was heavy; something talked to it every few minutes: the resolution cron every ten minutes, each MCP server syncing at session start (ten-minute throttle) and each daemon every fifteen, cache entries expiring every one to five minutes. Receipts were 830 MB of the 960 MB stored. The budget is $3 a month.

## Decision
- Compute is fixed at 0.25 CU. What matters is how many separate moments wake the database, so those are what get cut.
- Automatic Syncs land in **Sync Slots**: four fifteen-minute windows a day starting at 00:00, 06:00, 12:00 and 18:00 UTC. Collectors aim for the first five minutes. The sync route refuses an automatic Sync outside a window with a 429 *before* touching the database. Collectors send `x-sync-trigger: manual` for connect, `sync` and `sync_usage`, which are always taken. Collectors from before 0.3.0 send nothing and are treated as automatic. Their timers still land inside a window once per slot.
- The daily crons (markets 00:05, resolve 00:10, mint 00:20) run inside the midnight slot. Resolution is daily. Trading already stops on the clock, and pages label a Market closed from the clock, so the only thing that waits is the payout, at most a day.
- Public caches (boards, burn seasons, site stats, model usage) live for one slot and are marked stale when a Sync lands.
- Receipt Streams are kept for seven days, which covers every day a Device that has synced before may upload. Older days only arrive in a Device's first Sync. They are deduped against another Device's Usage row for the same day and model whose receipt count and output tokens are both within the 90% overlap tolerance. The mint job prunes the rest daily.

## Consequences
+ The database wakes about four times a day plus visits that miss the cache and trades. That is roughly 1–2 hours a day at 0.25 CU, about $1–2 a month. Storage drops to tens of MB, which fits Neon's free plan if the project ever moves there for a hard cap.
− Boards and profiles move every six hours unless a person syncs by hand.
− Old-day dedupe is judged from totals, not message identities. Two Devices whose old days have near-identical receipt counts and output for the same model are treated as one, which is the right call for the same transcripts and a rare false positive otherwise.
− The 429 path trusts the trigger header. Lying about it only lets someone wake the database more often, which costs money but not integrity.
