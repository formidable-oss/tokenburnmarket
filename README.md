<p align="left">
  <img src="apps/web/public/logo.svg" width="40" alt="tokenburnmarket mark" />
</p>

# tokenburnmarket

**Bet your burn.** Play-money prediction markets and leaderboards for AI coding agent usage.

Connect your machine, your agent usage (read through [ccusage](https://github.com/ryoppippi/ccusage)) becomes credits, and you bet those credits on who burns what next: inside your community, in your country, or on the world board. Polymarket mechanics, no crypto, no cash in, no cash out.

Built by [Formidable Builders](https://formidable.builders). MIT.

## Why this exists

There are plenty of "who spent the most tokens" boards. Most rank raw spend, most are easy to game, and none of them are fun for a group of friends for longer than a week. tokenburnmarket changes what is being ranked: you win by predicting your crew's burn, not by having the biggest bill.

- **Communities first.** Invite link, your own board, a fresh market every week.
- **Bets settle on usage.** Markets resolve automatically from synced data. No manual judging.
- **Whales do not own the game.** Credits mint on a curve that flattens above a daily kink, so betting skill matters more than budget.
- **Honest about verification.** Usage is signed by your device and checked for plausibility. We call that verified, and we say plainly that it is not proof.

## How it works

1. `npx tokenburnmarket connect` binds your machine. Approve the short code in the browser.
2. The collector runs ccusage, builds daily totals per provider and model, signs them, and syncs. Only totals and identifier hashes leave your machine, never transcripts.
3. Each closed day mints credits from your estimated cost (LiteLLM prices).
4. Bet on markets: who burns most this week, will someone cross a threshold, who wins head to head, which model wins the race.
5. Markets close, resolve from usage, and pay one credit per winning share.

Works with every agent ccusage can read: Claude Code, Codex, Cursor, Copilot, Gemini CLI, OpenCode, Amp, and more. Agents where we can read per-message identifiers (Claude Code, Codex) get **verified** usage; the rest are **reported** and mint at a discount.

## Repository

```
apps/web         Next.js App Router on Vercel. Neon Postgres, Drizzle, GitHub sign-in.
packages/core    Pure domain logic: mint curve, LMSR market maker, plausibility checks, sync schema. Tested.
packages/cli     npm `tokenburnmarket`: connect | sync | daemon | mcp | status. Depends on ccusage + core.
docs/adr         Architecture decisions.
docs/superpowers/specs   The v1 design spec.
CONTEXT.md       Vocabulary. Read this before naming anything.
DESIGN.md        Look, motion, voice.
CLAUDE.md        Entry point for coding agents.
```

## Develop

```sh
pnpm install
cp .env.example .env.local     # Neon DATABASE_URL, AUTH_SECRET, GitHub OAuth id + secret
pnpm dev                        # web on http://localhost:3000
pnpm check && pnpm test && pnpm build
```

## Design and decisions

- [ADR 0001](docs/adr/0001-nextjs-neon-drizzle-github-oauth.md) Next.js on Vercel, Neon + Drizzle, GitHub OAuth
- [ADR 0002](docs/adr/0002-lmsr-house-backed-market-maker.md) LMSR house-backed market maker
- [ADR 0003](docs/adr/0003-receipt-streams-and-trust-levels.md) Signed syncs, receipt streams, trust levels
- [ADR 0004](docs/adr/0004-curved-daily-credit-mint.md) Curved daily credit mint
- [v1 spec](docs/superpowers/specs/2026-08-17-tokenburnmarket-v1-design.md)

## Contributing

Work is broken into tracer-bullet issues labeled `ready-for-agent`, each listing what blocks it. Pick one whose blockers are done, open a PR against `main`. Keep copy short and human, keep numbers tabular, keep yellow for one action per view. See `DESIGN.md`.

## Status

Pre-alpha. Identity and landing exist; connect, sync, markets, and boards are in progress. Follow the issues.
