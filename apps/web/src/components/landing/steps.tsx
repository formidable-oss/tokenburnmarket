/*
  Three steps, asymmetric: the number is the visual anchor, copy stays short.
  Numerals use the pixel face; body copy never does.
*/
const steps = [
  {
    n: "01",
    title: "Connect",
    body: "Paste one prompt into your coding agent. Approve the device in your browser.",
    detail: "install · first upload · 15-minute sync",
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
    <ol className="grid gap-x-10 gap-y-12 md:grid-cols-3">
      {steps.map((s, i) => (
        <li key={s.n} className="rise" style={{ "--i": i + 3 } as React.CSSProperties}>
          <div className="flex items-baseline gap-4">
            <span className="font-display text-[3.25rem] leading-none text-primary" aria-hidden>
              {s.n}
            </span>
            <h3 className="type-heading">{s.title}</h3>
          </div>
          <p className="mt-4 max-w-[34ch] text-[0.95rem] text-muted">{s.body}</p>
          <p className="type-data mt-4 text-[0.78rem] text-subtle">{s.detail}</p>
        </li>
      ))}
    </ol>
  );
}
