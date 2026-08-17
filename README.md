# tokenburnmarket

Bet your burn. Connect your machine, your agent usage (via [ccusage](https://github.com/ryoppippi/ccusage)) becomes Credits, and you bet Credits on usage outcomes inside Communities and on global / country leaderboards. Polymarket mechanics, play money, no crypto, no cash-out.

- Web app: `apps/web` (Next.js on Vercel, Neon Postgres, GitHub sign-in)
- CLI / MCP server: `packages/cli` (`npx tokenburnmarket connect`)
- Domain logic: `packages/core` (mint curve, LMSR, plausibility checks; pure, tested)

Vocabulary lives in [CONTEXT.md](CONTEXT.md); decisions in [docs/adr](docs/adr); the v1 spec in [docs/superpowers/specs](docs/superpowers/specs).

## Develop

```sh
pnpm install
cp .env.example .env.local   # fill in Neon + GitHub OAuth
pnpm dev
pnpm check && pnpm test
```

## Verification, honestly

"Verified" usage means it arrived signed from a bound device with a coherent receipt stream and passed plausibility checks. It is not proof. See [ADR 0003](docs/adr/0003-receipt-streams-and-trust-levels.md).

MIT © Formidable Builders
