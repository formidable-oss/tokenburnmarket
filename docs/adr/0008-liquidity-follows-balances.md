# ADR 0008 — Market depth follows what people can stake

Status: accepted · 2026-11-26 · amends the sizing rule of ADR 0002

## Context
ADR 0002 sized a Market's liquidity `b` from headcount only: `20 + 5·members` for a Community, `100 + 5·participants` (capped at 1,000) for wider scopes. The mint kept filling balances while `b` stayed put. By late November a weekly Community Market had `b = 85` against member balances of 1,000 to 9,000 Credits. One bet of 12,924 Credits pinned this week's Market at 100¢ for every outcome but one, leaving nothing to trade for the rest of the week. A win could profit at most `b·ln(n)`, about 170 Credits, on any stake, so winners saw payouts barely above what they put in and read it as "nothing was paid".

## Decision
- A new Market's `b` is the larger of the headcount rule and half the median Credit balance of its audience. The audience is the Community's members, the country's Builders, or everyone. The balance term is capped at 1,000, the existing global cap, so the house's worst case on one Market stays bounded at about 1,000·ln(n).
- The balance term is also capped at 100 per person in the audience. Without that, two friends with large balances could open a deep weekly Market about themselves, buy the known winner late and collect up to `b·ln(n)` from the house every week. A two-person Community stays at `b ≤ 200`.
- Only members buy into a Community Market, because its depth is sized from them. Anyone may sell what they hold, so a Builder removed from a Community can still get out.
- `b` is still fixed at creation. Markets already open keep theirs, because changing `b` reprices every Position already held.
- At half the median, one typical member who puts their whole balance on one of eight outcomes moves it from 12¢ to about 88¢: a real move, not a lock. Formidable Builders goes from `b = 85` to about 531.

## Considered options
- A per-trade stake cap. Rejected: it limits the people who want to back a conviction. The stake was never the problem; the thin book was.
- Scaling `b` with total Credits in circulation. Rejected: one hoarder would deepen every Market. The median follows the typical trader.
- Raising the headcount constants. Rejected: it goes stale again as balances grow.

## Consequences
+ Bets of a normal size move prices without pinning them, and calling an outsider early pays several times the stake.
− The house subsidy, which is a Credit faucet, grows with `b`. The cap and the fact that it is realised only by traders who are right keep it modest. Revisit if Credits Won starts to dwarf the mint.
