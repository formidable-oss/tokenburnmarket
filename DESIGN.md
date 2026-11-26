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
| Muted | `--muted-foreground` | `#a9a9b8` | `#4e4e64` | Supporting copy. At least 6.9:1 on every surface. |
| Subtle | `--subtle-foreground` | `#8e8ea0` | `#676779` | Metadata. At least 4.7:1 on every surface. |
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
| Landing headline | `.type-display-hero` | Geist Pixel Circle | `clamp(3.25rem, 15vw, 6.75rem)` in one column, `9.5vw` from 1024px; landing page only |
| Title | `.type-title` | Geist Pixel Circle | `clamp(2rem, 5.6vw, 2.5rem)`. The `h1` of every page except the landing page. |
| Heading | `.type-heading` | Geist Pixel Circle | `clamp(1.35rem, 2.4vw, 1.75rem)`. Section headings. |
| Body | default | Geist | 1rem, line-height 1.55 |
| Label | `.type-label` | Geist Mono, uppercase, +0.08em | 0.72rem |
| Data | `.type-data` | Geist Mono, tabular | inherits |
| Pattern | `--font-pattern` | Geist Pixel Square | decorative only |

Pixel faces are for titles and big numerals, never for paragraphs. Mono is for labels and numbers, never for prose. Tabular numerals everywhere numbers stack.

No text is smaller than 0.7rem (about 11px).

A label above a title must add something the title and the navbar do not say, such as a breadcrumb (`docs / setup`) or a state (`community`, `unlisted`). The navbar marks the section you are in, so a top-level page does not repeat its section name above its title.

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
- **SiteHeader / SiteFooter / ThemeToggle** `site/*`: sticky translucent bar, primary nav with the left-growing underline, which stays on the section you are in (`aria-current`, set in `site/nav-links.tsx`). From 1024px the nav sits in the bar; below that it takes a second row under the bar. The theme toggle is a 40px outlined icon button that shows the mode you are in: moon for dark, sun for light.
- **Icons** `ui/icons.tsx`: GitHub, sun, moon. Inline SVG that takes the text color. Every "Sign in with GitHub" button carries the GitHub mark. `theme-light:` is the Tailwind variant for a utility that applies only in the light theme.
- **CostSparkline**, **UsagePanel** `usage/*`: thirty days of burn as server-rendered bars, then totals by agent and by model. No client JavaScript.
- **BoardTable**, **RegionTabs**, **BoardSwitches** `leaderboard/*`: the one leaderboard row anatomy (rank, avatar + handle, trust badge, value, places gained) and the link-only region tabs and season/metric switches. Every board renders through them, including the landing preview, so two boards can never disagree about a rank.
- **ModelBurnChart** `landing/*`: the hero chart. A running total of Usage tokens for the five most-burned models over the current month Season, as stepped lines inside the two open corners. The leader takes the yellow and the ember at its tip; the other lines are gray. Each line ends in a label with the total and the model name, so the labels are the ranking and there is no legend. Pointing at a day, or the arrow keys, moves the labels to the totals up to that day. It has no panel. It is not a Market, so it never uses the name Model Race.
- **StatsStrip**, **Steps** `landing/*`: four site numbers below the hero; the three steps as ledger rows (numeral, name, what happens), not cards. **MarketPreview** keeps the compact Market anatomy for Market contexts. **RegionBoards** `landing/*` is the same tab strip over real data.
- **Share cards** `app/og-card.tsx` with `lib/share-cards.ts`: one 1200x630 composition for every card. Mark and wordmark top left, a mono eyebrow, a headline in the pixel face with at most one word in primary, an optional panel of rows on the right, one quiet line at the bottom. A route maps its data to a `ShareCard` and never lays out pixels. Cyan is reserved for prices there too, and the ember dot only appears next to numbers that move.
- **LogoMark / Wordmark / Logo** `brand/logo.tsx`.

## 6. Motion

- Curve: `--ease-out-expo` `cubic-bezier(0.16, 1, 0.3, 1)`. Exits faster than entrances.
- Page load: `.rise` (0.5rem up, 420ms) staggered by `--i` at 70ms steps. One orchestrated entrance, then quiet.
- The hero chart draws one day per step, left to right (`.tape-wipe`, 45ms a day, 900ms at most). Its markers and labels arrive when the wipe ends. This is part of the same entrance.
- The theme icon turns and fades in 200ms when the mode changes.
- The ember dot pulses opacity only. Nav underline scales in from the left in 180ms.
- Transform and opacity only. `prefers-reduced-motion` collapses everything to instant.

## 7. Voice

Short, human, direct. Sentences over slogans. Numbers over adjectives. No exclamation marks, no em dashes, no "unlock", "supercharge", "seamless". Say what happens: "One command binds your machine." Be honest about limits: "Verified means signed and plausible. Not proof."

## 8. Accessibility

WCAG 2.2 AA contrast, visible focus ring from `--ring`, 40px targets, skip link, semantic lists for markets and boards, `aria-label` on the mark, no color-only state.
