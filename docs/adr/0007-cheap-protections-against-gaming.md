# ADR 0007 — Cheap protections: impossible cost, a week of top-ups, trading permission, connect confirmation

Status: accepted · 2026-10-24 · limits the upward re-mint of ADR 0004

## Context
ADR 0006 stopped holding back usage for its size or age. A review of the Collector then listed the ways a Builder can still game the system. The easiest needs no skill: edit a transcript file, then sync. A short script that uses the Builder's own device key can upload any past day at any cost. Raising an old day kept paying Credits, because the mint topped up a day of any age. Anyone signed in could approve a connect code they saw, for example on a stream, and a device token could trade its Builder's Credits.

None of this can be closed fully: usage comes from files on the Builder's own machine (ADR 0003). The community is small and the stakes are play money, so the goal is to close the cheap gains and keep real usage untouched.

## Decision
- A row whose cost is higher than its tokens could cost at $2,000 per million is a number no real usage can produce. The server refuses it like a day that has not started. The dearest model in LiteLLM's price list charges $600 per million output tokens, so the bound leaves room for priority and fast-mode pricing.
- A day that has been minted can be topped up for 7 days after it first became mintable. After that its Credits are final, so usage added to an old day later moves the boards but mints nothing. A day never minted still mints once at any age, so a new Builder's history and restored days are paid. An Admin's approval mints whatever the day's age.
- A Device may place bets only after its Builder allows it, with a checkbox on the approval page that starts unticked, or in Settings. Quotes stay open. Devices approved before this decision keep trading, so the MCP server keeps working for them.
- In a terminal, `connect` names the account that approved the code and asks before it saves anything. An agent that runs `connect` without a terminal is not asked.

## Considered options
- A hard cap on Credits per day. Deferred: the curve already flattens (about 220 Credits for a $10,000 day), and a cap is a fairness event that needs a new curve version.
- Holding large rows for an Admin. Rejected for now: it brings back the quarantine of real heavy usage that ADR 0006 removed.

## Consequences
+ Raising old days, by hand or by script, no longer mints Credits after a week.
+ A code approved by the wrong person cannot spend Credits, and a person at the terminal sees the account before the machine syncs to it.
− Editing transcripts still raises boards and markets, and still mints Credits for days inside the week. Better evidence, for example usage totals that providers show for an account, is still future work.
− A Builder who wants their agent to place bets has to tick a box or press a button once.
