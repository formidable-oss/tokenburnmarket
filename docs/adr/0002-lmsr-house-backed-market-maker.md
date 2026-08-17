# ADR 0002 — LMSR house-backed automated market maker

Status: accepted · 2026-08-17

## Context
Markets are play-money with thin liquidity (communities of 5–50). An order book (Polymarket CLOB) would leave most markets untradeable; CPMM needs seeded liquidity and handles many outcomes poorly.

## Decision
Hanson's Logarithmic Market Scoring Rule. Each Market has liquidity parameter `b` set at creation from scope size (`b = 20 + 5·members`, larger for global). Prices sum to 1; buys and sells against the AMM at any time before close; winning shares pay 1 Credit; the house's bounded loss (≤ b·ln n) is minted. No fees in v1. Implemented in `packages/core` as pure functions with property tests.

## Consequences
+ Always liquid, multi-outcome native, one tunable.  − House subsidy is a credit faucet; keep `b` modest. − Sharp movers can extract subsidy — acceptable in play money.
