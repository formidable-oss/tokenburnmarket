# tokenburnmarket — v1 design

Repo: `formidable-oss/tokenburnmarket`. Vocabulary: `CONTEXT.md`. Decisions: `docs/adr/`.

## 1. Product

Builders connect their machine, their agent usage (via ccusage) becomes Credits, and they bet Credits on usage outcomes — inside Communities and on global/country boards. Polymarket mechanics, play money, no crypto, no cash-out.

Audience: developers on X. Tone: minimal, data-dense, "Digital Heritage" look (dark `#050510` canvas, yellow `#ffd900` action color, red/cyan sparse accents, Geist / Geist Mono / Geist Pixel Circle headings).

Out of scope for v1: free-text/manually-resolved markets, fees, email/X login, mobile app, realtime sockets, seasons with team drafts, output-based scoring.

## 2. Core loops

1. **Connect**: sign in with GitHub → `npx tokenburnmarket connect` → approve short code in browser → device bound.
2. **Sync**: Collector runs ccusage, builds daily aggregates + Receipt Stream, signs, uploads deltas. Triggered by MCP tool `sync_usage`, Claude Code `Stop` hook, `tokenburnmarket sync`, or the daemon (every 15 min).
3. **Mint**: cron closes each UTC day → Credits per ADR 0004.
4. **Compete**: leaderboards (community / country / global × week / month / all-time × cost / tokens / credits won).
5. **Bet**: LMSR markets (ADR 0002) from templates; auto-created weekly Top Burner per community and weekly Model Race globally; resolve by cron from Usage.
6. **Share**: OG-image share card per profile / market / leaderboard.

## 3. Repo layout (pnpm workspace)

```
apps/web            Next.js App Router (Vercel)
packages/core       pure TS: mint curve, LMSR, plausibility checks, sync payload schema (zod), signing helpers — 100% unit/property tested
packages/cli        npm `tokenburnmarket`: connect | sync | mcp | daemon | status; depends on ccusage + core
docs/adr, CONTEXT.md, README
```

## 4. Data model (Neon Postgres, Drizzle)

- `builders` (id, github_id, handle, avatar_url, x_handle?, country?, created_at)
- `devices` (id, builder_id, name, public_key, created_at, last_sync_at, revoked_at)
- `device_connect_codes` (code, builder_id?, device_pubkey, expires_at, approved_at)
- `usage_days` (builder_id, device_id, day, provider, model, input_tokens, cached_input_tokens, cache_write_tokens, output_tokens, reasoning_tokens, cost_usd, trust_level, receipt_count, checked_at)  PK (device_id, day, provider, model)
- `receipts` (device_id, day, hash bytea) — for cross-device dedupe; pruned after 45 days
- `builder_days` (builder_id, day, cost_usd, tokens, trust_level_min, credits_minted, mint_version) — materialized daily rollup, source for boards and mint
- `credit_ledger` (id, builder_id, delta, reason enum: signup|mint|buy|sell|payout|refund, ref_id, created_at); balance = sum, cached on `builders.credit_balance`
- `communities` (id, slug, name, bio, visibility public|unlisted, owner_id, invite_code, created_at)
- `memberships` (community_id, builder_id, role owner|member, joined_at)
- `markets` (id, scope community|country|global, community_id?, country?, type top_burner|threshold|head_to_head|model_race, params jsonb, b numeric, opens_at, closes_at, resolves_at, status open|closed|resolved|voided, winning_outcome_id?, created_by)
- `outcomes` (id, market_id, label, ref jsonb (builder_id / model / provider), shares_outstanding)
- `positions` (market_id, outcome_id, builder_id, shares, cost_basis)
- `trades` (id, market_id, outcome_id, builder_id, side, shares, credits, price_after, created_at)
- `quarantine_reviews` (usage key, reason, status, reviewer, note)

## 5. Ingest API & Collector

- `POST /api/connect/start` (CLI, unauth): {pubkey} → {code, url, expires}. Browser `GET /connect/:code` (auth) → approve → device row. CLI polls `GET /api/connect/:code` → device token (JWT bound to device id).
- `POST /api/sync` (device token + Ed25519 signature over canonical JSON body): `{deviceId, sentAt, days: [{day, provider, model, tokens…, costUsd, receipts: [hash…]}]}` for days changed since watermark, always including today and yesterday. Server: verify sig → dedupe receipts across the builder's devices → plausibility (core) → upsert `usage_days` → recompute `builder_days` for touched days → respond with per-day trust levels and next watermark.
- CLI: `connect`, `sync` (one-shot), `daemon` (interval, launchd/systemd instructions), `mcp` (stdio MCP server: `sync_usage`, `my_stats`, `my_communities`, `list_markets`, `place_bet` (calls web API with device token; bets confirmed with amount echo)), `status`. Prints exact `claude mcp add` / Codex config lines after connect.
- Receipt Stream extraction: Claude Code (`~/.claude/projects/**/*.jsonl` assistant messages → sha256(`message.id:requestId`)), Codex (`~/.codex/sessions/**/*.jsonl` `token_count` events → sha256(session_id:turn ordinal:timestamp)). Other ccusage agents → Reported.

## 6. Markets

- Templates and resolvers in `packages/core` given a resolution snapshot of `builder_days` / model totals; web wraps with DB reads.
- Creation: form per template with validated params (period, threshold amount, two builders, etc.); community owner or any member (owner can restrict); global/country markets created by admins + weekly auto Model Race and Top Burner (country).
- Trading: buy/sell against LMSR; slippage preview computed client-side from `core` with the same function used server-side; server recomputes and rejects if price moved > 1% (or user accepted a max).
- Resolution: cron every 10 min: close at `closes_at`, resolve at `resolves_at` (period end + 24h late-sync buffer); if any referenced usage is Quarantined at resolution → hold 24h, then void if unresolved. Payout: 1 Credit per winning share via ledger.

## 7. Web pages

`/` landing (what it is + live global stats + connect CTA) · `/leaderboard` (global/country tabs, period, metric) · `/c/:slug` (community board, markets, members, invite) · `/c/:slug/markets/:id` and `/m/:id` (market page: prices, chart, buy/sell, positions, rules/resolution) · `/@:handle` (profile: usage sparkline by provider/model, credits, positions, badges) · `/connect/:code` · `/settings` (devices, country, X handle, revoke) · `/admin` (quarantine reviews, global market creation) · `/api/og/*` share cards · `/docs` (setup, how verification works, market rules).

## 8. Anti-cheat rules (v1)

Per ADR 0003: receipt-stream coherence, per-model tokens/sec ceiling, ratio bounds, daily cost ceiling per provider (configurable table), monotone watermark with 2-day backfill; violation → Quarantined + admin queue. Copy: "Verified means signed and plausible, not proven."

## 9. Testing

`packages/core`: unit + property tests (LMSR invariants: prices sum to 1, buy-then-sell round trip ≤ 0 profit, bounded house loss; mint curve monotone/concave; resolvers on fixture snapshots). `apps/web`: route tests for sync/trade endpoints against Neon branch; Playwright smoke for connect → sync → bet → resolve. CLI: parser tests on fixture transcripts (Claude/Codex).

## 10. Rollout

1. core + schema + auth + connect/sync + profile
2. leaderboards (community/country/global)
3. LMSR + market templates + trading + cron resolution
4. CLI polish (daemon, MCP, hook), share cards, docs, landing
5. Deploy to Vercel under formidable-oss; publish `tokenburnmarket` to npm.
