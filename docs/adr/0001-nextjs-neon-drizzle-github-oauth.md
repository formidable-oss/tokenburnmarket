# ADR 0001 — Next.js on Vercel, Neon + Drizzle, GitHub OAuth

Status: accepted · 2026-08-17

## Context
The app needs SSR pages, a few interactive market widgets, cron jobs, and a public ingest API. formidable-products (design inspiration) uses Hono JSX SSR without a client framework. Reusing that stack was considered.

## Decision
Next.js App Router on Vercel; Neon Postgres via Drizzle; Auth.js with GitHub as the only sign-in; Vercel Cron for minting and market resolution. Design tokens are ported from formidable-products' DESIGN.md; the code is not.

## Consequences
+ React for buy/sell forms, price previews, charts.  + Familiar to contributors; monorepo with a TypeScript CLI.
− Heavier than the Hono shell; must be disciplined about client bundles (islands only where interactive).
