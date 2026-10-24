# ADR 0006 — Re-syncs add, raise or correct; one Machine counts once; only impossible numbers quarantine

Status: accepted · 2026-10-24 · supersedes the plausibility ceilings and the watermark check of ADR 0003, and the history review of ADR 0005 · extended by ADR 0007

## Context
0.4.0 offered `sync --review-history` to send corrected history. The server replaced every old row whose figures had changed and quarantined it for its age (`stale_backfill`). After a Collector update almost every old row changes, so one run took most of a Builder's history out of Leaderboards and Credits, and only an Admin could bring it back, one row at a time. A plain re-sync could not repair it, because the server kept stored rows past the backfill window as they were. The age check protected little: the first Sync of a new Device may upload any history.

The other ceilings (output rate, output to input, cache ratio, daily cost) quarantined real usage. Parallel agents and API loops produce all of those shapes.

A Builder who reconnects a Machine gets a new Device that uploads the same history again. Receipts expire after seven days (ADR 0005), so the old days of the two Devices only match when every figure is identical, and a newer Collector rarely produces identical figures. Both copies count.

## Decision
- Only a number that no real usage can produce is held back: a negative count, or a day that has not started. The server answers such a row and does not store it, so one row cannot hold a whole Builder-day out of boards and markets. A Receipt Stream that does not fit its tokens makes the row Reported. Age, size, speed, ratios and cost hold nothing back. Quarantine is left for rows an Admin keeps out.
- Inside the backfill window, a Device's latest reading replaces what is stored. Past it, a reading replaces the stored row only when it supersedes it: it reports at least as many processed tokens; or it has at least as many receipts as the stored row and at least half its tokens, so the Machine still has every message behind it and lower figures are a correction. A receipt count at the per-day cap is not evidence. Otherwise the stored row stays. A Sync never replaces a row an Admin kept out.
- A Machine counts each day once. Every Device starts as a Machine of its own, and the Builder marks the Devices of one Machine in Settings. For each (day, provider, model), the Machine counts the row that the same supersede rule picks, taking its Devices' readings in the order they arrived. Different Machines always add up.
- The Collector keeps its key when it reconnects, so the server keeps the same Device. If another Builder approves a key that is already in use, or the Builder approves the key of a Device they revoked, the old Device is retired with the Usage it uploaded and the approval gets a new Device. A laptop that inherits a sold laptop's config therefore cannot replace that laptop's days. `--since N` is no longer limited to the backfill window, and `--all` sends every day the Machine has. The server still accepts the `reviewHistory` flag from 0.4.0 and ignores it. The Collector leaves out a row the server would refuse and says why, so one bad row cannot block a Sync.
- The daily mint job restores every row that is Quarantined only for checks that no longer exist, unless an Admin's latest decision was to keep it out. It runs before the mint, so restored days are minted the same night. It is a job and not a migration because a server from before this decision can still quarantine rows while it is being replaced. Migration 0011 only adds the Machine column, so it is safe to run before the deploy.
- The Neon HTTP driver has no transactions, so a Sync, a recount or a restore can stop between writing rows and writing their Builder-day. Before each mint, the job also rebuilds every Builder-day whose totals do not match its counted rows. Races between two Syncs, or between a Sync and a change in Settings, are settled again after the writes.

## Considered options
- Keep the quarantine for corrections and add bulk approval. Rejected: accepted usage would still leave the totals until an Admin acts.
- Count unusual rows but flag them for review. Deferred: there is no review flow for counted rows yet, and the flags would be the start of better anti-cheat work.
- Detect Machines from a hardware id. Rejected: cloned VMs share hardware ids, and a wrong merge silently loses real usage. A wrong split shows up as a double count that the Builder can fix in Settings.

## Consequences
+ A re-sync can add, raise or correct usage. It cannot lower an older day because the Machine lost part of its history.
+ Heavy usage counts in full.
− A Builder can inflate old days on purpose. ADR 0003's answer still holds: play money and community visibility. Better evidence is future work, for example a comparison with the usage totals that providers show for an account.
− An old estimate that was too high and has no receipts stays. Without receipts a correction and lost history look the same, so a lower reading cannot replace it.
− Devices that connected one Machine more than once before Collector 0.5.0 count twice until the Builder marks them as one Machine.
