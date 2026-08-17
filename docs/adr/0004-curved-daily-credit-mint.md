# ADR 0004 — Curved daily Credit mint

Status: accepted · 2026-08-17

## Context
If Credits scaled linearly with spend, Max-20x subscribers would own every market and betting skill would not matter.

## Decision
Per Builder per UTC day, cost `c` (USD, all devices, LiteLLM prices via ccusage): `mint = min(c, 20) + 2·√(max(c−20, 0))`; Reported usage at 50%; 100-Credit signup grant; minted after the day closes with a 24h late-sync buffer and re-minted upward if the day's usage grows. Credits cannot be bought or cashed out.

## Consequences
+ Whales earn ~2–4×, not 20×.  + No real-money path → not gambling.  − Curve parameters are a product lever; changing them later is a fairness event, so version the curve.
