/*
  How to play, in three steps, at the top of /markets. Open for anyone who has
  not settled a bet yet; folded for those who have, because the rules are noise
  once you have been paid by them. The worked numbers are the point: "a winning
  share pays 1 credit" means little until it is "at 20¢ that is five times".
*/
import Link from "next/link";

const STEPS = [
  {
    title: "Earn credits",
    body: "Every day your usage syncs, it mints credits. Play money: never bought, never cashed out.",
  },
  {
    title: "Back an outcome",
    body: "A price is the crowd's odds. At 20¢ a share costs a fifth of a credit and pays 1 credit if it wins, about five times your stake. At 95¢ a win returns about 5% and a loss takes it all. The trade form shows the payout before you buy.",
  },
  {
    title: "Get paid",
    body: "Markets settle the night after they close, from the same usage that feeds the leaderboards. Winnings land in your balance, and every result is on your profile.",
  },
] as const;

export function HowToPlay({ open }: { open: boolean }) {
  return (
    <details open={open} className="group rounded-(--radius-panel) border border-border bg-surface">
      <summary className="type-label flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 sm:px-6 [&::-webkit-details-marker]:hidden">
        <span>how to play</span>
        <span aria-hidden className="text-subtle transition-transform duration-150 group-open:rotate-45">
          +
        </span>
      </summary>
      <ol className="grid gap-6 border-t border-border-faint px-5 py-5 sm:grid-cols-3 sm:px-6">
        {STEPS.map((step, index) => (
          <li key={step.title} className="min-w-0">
            <p className="type-data text-[0.78rem] text-primary-text tabular-nums">
              {String(index + 1).padStart(2, "0")}
            </p>
            <h3 className="mt-1.5 text-[0.98rem]">{step.title}</h3>
            <p className="mt-1.5 text-[0.88rem] text-muted">{step.body}</p>
          </li>
        ))}
      </ol>
      <p className="border-t border-border-faint px-5 py-3 text-[0.82rem] text-subtle sm:px-6">
        Prices move as people trade and are an opinion, not a forecast.{" "}
        <Link href="/docs/markets" className="underline decoration-border-strong hover:text-foreground">
          The full rules
        </Link>
      </p>
    </details>
  );
}
