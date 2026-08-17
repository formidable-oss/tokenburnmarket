# tokenburnmarket

Read first: `CONTEXT.md` (vocabulary), `docs/adr/` (decisions), `docs/superpowers/specs/2026-08-17-tokenburnmarket-v1-design.md` (v1 scope), `DESIGN.md` (look, motion, voice). Work the GitHub issues in dependency order; each issue lists what blocks it.

Commands: `pnpm dev`, `pnpm check`, `pnpm test`, `pnpm build` (all from the repo root, run across the workspace).

## Design Context

### Users
Developers who live in Claude Code, Codex, Cursor and similar agents, and hang out on X. They arrive from a share card or a friend's invite, on a laptop, mid-session. Job to be done: connect in under a minute, see where they rank, place a bet, share it. They are allergic to marketing copy and to anything that looks like a casino.

### Brand Personality
Sharp, honest, playful under a straight face. Three words: dense, candid, warm. It should feel like a trading floor built by friends: confident numbers, quiet UI, a wink in the copy. Never hype, never "gamified" in the badge-confetti sense. We say plainly that "verified" is not proof.

### Aesthetic Direction
Formidable "Digital Heritage": deep-space canvas, one loud yellow for action and burn, a rare red ember, cyan reserved for prices and forecasts. Geist for copy, Geist Mono for labels and numbers, Geist Pixel Circle for titles and big numerals. Dark by default, parchment light mode by choice. Flat panels with 1px borders, dashed signal rails between sections, asymmetric layouts. Anti-references: neon glass dashboards, purple gradients, gradient text, card grids of icon + heading + blurb, gambling-site red/green flashing.

### Design Principles
1. Numbers first. Every screen is a table or a market before it is a page. Align them, make them tabular, let them breathe.
2. One yellow per view. Primary color means "the thing to do here" and "burn". Everything else stays quiet.
3. Words next to color. Trust, state and outcome always have a label; color only reinforces.
4. Short and human. Sentences, not slogans. No em dashes, no exclamation marks, no filler.
5. Motion is state. One orchestrated entrance, then only feedback. Transform and opacity only.
