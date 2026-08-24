/*
  The docs index of record. The rail beside every page and the list on the
  overview page both read it, so a new page is added in one place.
*/
export const DOCS_PAGES = [
  { href: "/docs", label: "Overview", blurb: "What this is, and the shortest path through it." },
  {
    href: "/docs/setup",
    label: "Setup",
    blurb: "Give your agent one prompt. It installs the collector and keeps usage synced.",
  },
  {
    href: "/docs/verification",
    label: "Verification",
    blurb: "Trust levels, receipt streams, the checks, and what verified does not mean.",
  },
  {
    href: "/docs/markets",
    label: "Markets",
    blurb: "The four templates, how prices move, slippage, resolution, holds and voids.",
  },
  {
    href: "/docs/credits",
    label: "Credits",
    blurb: "The mint curve, the reported discount, the signup grant, no cash.",
  },
] as const;
