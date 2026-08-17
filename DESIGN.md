# tokenburnmarket design system

Source of truth for how the product looks and moves. Tokens live in `apps/web/src/app/globals.css`; the mark lives in `apps/web/src/components/brand/logo.tsx`. If this document and the code disagree, fix one of them in the same PR.

## 1. Identity

A trading floor for token burn, drawn in the Formidable "Digital Heritage" language: deep-space canvas, one loud yellow, a rare red ember, restrained cyan for anything that looks into the future (prices, forecasts). Nothing glows for decoration. Data is dense and aligned. Copy is short and human.

**The mark.** Five stepped bars on a pixel grid, heights 3·5·9·6·4. Read left to right it is market depth; read as a silhouette it is a flame. The top pixel of the tallest bar is the ember (red). Two open corners frame it, never a full box, which is the family tie to the Formidable FF monogram. Regenerate `public/logo.svg`, `public/logo-light.svg`, and `src/app/icon.svg` from the same map if the bars change.

**The wordmark.** `tokenburnmarket` in Geist semibold, lowercase, with `burn` in the primary text color. No spaces, no capitals, no tagline attached.

## 2. Color

| Role | Token | Dark | Light | Use |
| --- | --- | --- | --- | --- |
| Canvas | `--background` | `#050510` | `#faf8f0` | Page |
| Surface | `--surface` | `#0f0f1f` | `#ffffff` | Panels, rows |
| Raised | `--surface-raised` | `#1a1a2e` | `#ffffff` | Popovers, hover fills |
| Sunken | `--surface-sunken` | `#0a0a1a` | `#f1eee2` | Inputs, bar tracks |
| Text | `--foreground` | `#f0f0f5` | `#14142b` | Copy |
| Muted | `--muted-foreground` | `#9090a0` | `#5a5a70` | Supporting copy |
| Subtle | `--subtle-foreground` | `#767686` | `#7c7c90` | Metadata |
| Border | `--border` / `--border-faint` / `--border-strong` | tonal | tonal | Dividers, controls |
| Primary | `--primary` | `#ffd900` | `#003399` | Action, selection, focus, burn bars |
| Ember | `--ember` | `#c41e3a` | `#b3172f` | The live dot, the honesty strip, the mark's hot pixel. Sparse. |
| Cyber | `--cyber` | `#00f0ff` | `#007a8a` | Prices and forecasts only |
| Won | `--won` | `#64f2b8` | `#0f8a5c` | Credits won, settled in your favor |
| Destructive | `--destructive` | `#ef4444` | `#c62828` | Errors, irreversible actions |

Rules:
- Only CSS variables. No hex in components.
- Yellow is the one primary per view. Buttons, focus, selection, and burn amounts share it on purpose.
- Color never carries meaning alone: every badge, price, and state has a word next to it.
- Dark is default. Light is an explicit choice stored under `tbm-theme` and applied before paint by the inline script in `layout.tsx`.
- Light mode swaps yellow for EU blue as the primary; everything else keeps its role.

## 3. Type

| Level | Class | Face | Size |
| --- | --- | --- | --- |
| Display | `.type-display` | Geist Pixel Circle | `clamp(2.5rem, 6vw, 5rem)` |
| Heading | `.type-heading` | Geist Pixel Circle | `clamp(1.35rem, 2.4vw, 1.75rem)` |
| Body | default | Geist | 1rem, line-height 1.55 |
| Label | `.type-label` | Geist Mono, uppercase, +0.08em | 0.72rem |
| Data | `.type-data` | Geist Mono, tabular | inherits |
| Pattern | `--font-pattern` | Geist Pixel Square | decorative only |

Pixel faces are for titles and big numerals, never for paragraphs. Mono is for labels and numbers, never for prose. Tabular numerals everywhere numbers stack.

## 4. Space and layout

- 4px base. Content max 1200px with 16px to 48px gutters (`px-4 sm:px-6 lg:px-12`).
- Rhythm, not uniformity: tight inside a row (4 to 12px), medium around controls (16 to 24px), generous between sections (80 to 96px).
- Sections are separated by the **signal rail** (`.signal-rail`): a dashed 1px line, the interrupted-signal motif.
- Asymmetric two-column heroes (`1.1fr / 0.9fr`, `0.8fr / 1.2fr`). Avoid centered stacks.
- Panels are flat: 1px border on `--surface`, radius `--radius-panel` (12px). No nested panels, no drop shadows on persistent surfaces.

## 5. Components (built)

- **Button** `ui/button.tsx`: primary, secondary, ghost. 40px target. Accepts `as={Link}`.
- **Badge** `ui/badge.tsx`: verified, reported, quarantined, won, neutral. Always contains a word. Quarantined is the one place ember appears outside the honesty strip.
- **CommandLine** `ui/command-line.tsx`: `$ command [copy]`. Inline copy feedback, no toast. `prompt={null}` drops the sigil for text that is not a command, such as an invite link.
- **SiteHeader / SiteFooter / ThemeToggle** `site/*`: sticky translucent bar, primary nav with the left-growing underline, day/night toggle.
- **CostSparkline**, **UsagePanel** `usage/*`: thirty days of burn as server-rendered bars, then totals by agent and by model. No client JavaScript.
- **MarketPreview**, **RegionBoards**, **Steps** `landing/*`: static previews that define the row anatomy for the real market page (issue #9) and the region tab strip + table for boards (issue #8). Reuse the anatomy, replace the data.
- **LogoMark / Wordmark / Logo** `brand/logo.tsx`.

## 6. Motion

- Curve: `--ease-out-expo` `cubic-bezier(0.16, 1, 0.3, 1)`. Exits faster than entrances.
- Page load: `.rise` (0.5rem up, 420ms) staggered by `--i` at 70ms steps. One orchestrated entrance, then quiet.
- The ember dot pulses opacity only. Nav underline scales in from the left in 180ms.
- Transform and opacity only. `prefers-reduced-motion` collapses everything to instant.

## 7. Voice

Short, human, direct. Sentences over slogans. Numbers over adjectives. No exclamation marks, no em dashes, no "unlock", "supercharge", "seamless". Say what happens: "One command binds your machine." Be honest about limits: "Verified means signed and plausible. Not proof."

## 8. Accessibility

WCAG 2.2 AA contrast, visible focus ring from `--ring`, 40px targets, skip link, semantic lists for markets and boards, `aria-label` on the mark, no color-only state.
