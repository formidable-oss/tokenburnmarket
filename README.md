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
cp .env.example apps/web/.env.local          # Neon DATABASE_URL, AUTH_SECRET, GitHub OAuth id + secret
pnpm --filter @tokenburnmarket/web db:migrate   # apply migrations to that database
pnpm dev                                      # web on http://localhost:3000
pnpm check && pnpm test && pnpm build
```

Without a GitHub OAuth app, set `DEV_USER` to a GitHub handle and `/signin` offers a local
sign-in as that Builder. That provider is never registered in production.

Schema lives in `apps/web/src/db/schema.ts`. After changing it, run
`pnpm --filter @tokenburnmarket/web db:generate` and commit the SQL in `apps/web/drizzle/`.

## Design and decisions

- [ADR 0001](docs/adr/0001-nextjs-neon-drizzle-github-oauth.md) Next.js on Vercel, Neon + Drizzle, GitHub OAuth
- [ADR 0002](docs/adr/0002-lmsr-house-backed-market-maker.md) LMSR house-backed market maker
- [ADR 0003](docs/adr/0003-receipt-streams-and-trust-levels.md) Signed syncs, receipt streams, trust levels
- [ADR 0004](docs/adr/0004-curved-daily-credit-mint.md) Curved daily credit mint
- [v1 spec](docs/superpowers/specs/2026-08-17-tokenburnmarket-v1-design.md)

## Contributing

Work is broken into tracer-bullet issues labeled `ready-for-agent`, each listing what blocks it. Pick one whose blockers are done, open a PR against `main`. Keep copy short and human, keep numbers tabular, keep yellow for one action per view. See `DESIGN.md`.

## Production

Live at **https://tokenburnmarket.vercel.app**. Docs at [/docs](https://tokenburnmarket.vercel.app/docs).

Vercel project `tokenburnmarket` under the `stockestate` team (Pro), Root Directory `apps/web`, connected to this repository for automatic deploys. The pnpm workspace installs from the repo root, so `packages/core` builds with the app. Cron schedules come from `apps/web/vercel.json`, which is the project root Vercel builds.

Environment variables, set for Production and Preview:

| variable | value |
| --- | --- |
| `DATABASE_URL` | Neon Postgres. One database serves development and production for now; split it before there are real users. |
| `AUTH_SECRET` | 32 random bytes, base64. Generated for the deployment, not shared with development. |
| `CRON_SECRET` | The bearer token the cron routes check. Without it they answer 401. |
| `ADMIN_HANDLES` | `alexconstantin` |
| `NEXT_PUBLIC_APP_URL` | `https://tokenburnmarket.vercel.app` |
| `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` | Not set yet. Sign-in is dark until they are. See below. |

### Sign-in needs a GitHub OAuth app

A human has to create it; there is no API for this. Once it exists, sign-in works with no code change.

1. Go to https://github.com/settings/developers (or the org's developer settings) and choose **New OAuth App**.
2. Application name `tokenburnmarket`, homepage URL `https://tokenburnmarket.vercel.app`.
3. Authorization callback URL: `https://tokenburnmarket.vercel.app/api/auth/callback/github`.
4. Register, then **Generate a new client secret**.
5. `vercel env add AUTH_GITHUB_ID production` and `vercel env add AUTH_GITHUB_SECRET production`, then the same for `preview`.
6. Redeploy: `vercel deploy --prod`.

For preview deployments, add a second OAuth app whose callback is the preview URL, or accept that sign-in only works in production.

### Cron schedules

`/api/cron/mint` runs daily at 01:00 UTC, `/api/cron/markets` Mondays at 00:05 UTC, `/api/cron/resolve` every ten minutes. Sub-daily crons need a Pro team; the project lives on one. Deployment Protection is switched off for this project because the app is public and the cron endpoints authenticate with `CRON_SECRET`.

## Status

Pre-alpha, deployed. Landing, boards, communities, connect, sync, markets and docs are live at the URL above. Sign-in waits on the GitHub OAuth app. Follow the issues.
