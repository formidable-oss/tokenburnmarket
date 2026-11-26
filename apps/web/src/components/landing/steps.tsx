/*
  Three steps as ledger rows, not cards: numeral, name, what happens. The
  numbers stay because the steps are a real sequence. Numerals use the pixel
  face; body copy never does.
*/
import { SYNC_SLOT_HOURS } from "@tokenburnmarket/core";

const steps = [
  {
    n: "01",
    title: "Connect",
    body: "Paste one prompt into your coding agent. Approve the device in your browser.",
    detail: `install · first upload · ${SYNC_SLOT_HOURS}-hour sync`,
  },
  {
    n: "02",
    title: "Burn",
    body: "Your agent usage syncs through ccusage and mints credits every day. The curve flattens, so whales earn more, not everything.",
    detail: "Claude Code · Codex · Cursor · 40+ agents",
  },
  {
    n: "03",
    title: "Bet",
    body: "Markets on who burns what, inside your community or on the global board. Always liquid. Winning shares pay one credit.",
    detail: "no cash in · no cash out",
  },
];

export function Steps() {
  return (
    <ol className="border-b border-border-faint">
      {steps.map((s) => (
        <li
          key={s.n}
          className="grid grid-cols-[3.25rem_1fr] items-baseline gap-x-5 gap-y-2 border-t border-border-faint py-7 sm:grid-cols-[3.75rem_7.5rem_1fr] sm:gap-x-6"
        >
          <span className="font-display text-[2rem] leading-none text-primary" aria-hidden>
            {s.n}
          </span>
          <h3 className="type-heading">{s.title}</h3>
          <div className="col-start-2 sm:col-start-3">
            <p className="max-w-[48ch] text-[0.95rem] text-muted">{s.body}</p>
            <p className="type-data mt-3 text-[0.78rem] text-subtle">{s.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
