import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Verification",
  description:
    "Trust levels, receipt streams and plausibility checks: what verified usage means on tokenburnmarket, and what it does not.",
  alternates: { canonical: "/docs/verification" },
};

/*
  The checks mirror checkPlausibility and DEFAULT_PLAUSIBILITY_LIMITS in
  packages/core/src/plausibility.ts. Change both together.
*/
const checks = [
  ["Negative counts", "A token count or a cost below zero. The collector leaves the row out and says why."],
  ["Future day", "Usage on a day that has not started yet on the server clock. The server does not store it, and the collector sends that day again once it has begun."],
  [
    "Cost",
    "A cost higher than the tokens could cost at any model's price: $2,000 per million tokens, which leaves room for priority pricing on the dearest model. The server does not store it.",
  ],
  [
    "Receipt coherence",
    "Each receipt stands for a message or billed turn, so tokens per receipt has to be believable. A stream that does not fit its tokens is not evidence, and the day is reported instead of verified.",
  ],
] as const;

export default function DocsVerificationPage() {
  return (
    <article>
      <p className="type-label">docs / verification</p>
      <h1 className="type-heading mt-3">Verified means signed and plausible.</h1>
      <p className="mt-4 text-[1.05rem] text-muted">
        Not proof. Usage comes from files on your own machine, and no provider publishes per-person
        token totals for a subscription account. Nobody can prove what you burned. What we can do
        is make faking it expensive and obvious.
      </p>

      <div className="signal-rail my-10" aria-hidden />

      <h2 className="type-heading">Trust levels</h2>
      <p className="mt-3 text-[0.95rem] text-muted">
        Every day of usage carries one of three. When a day is made of several rows, the weakest
        one wins.
      </p>

      <ul className="mt-6 grid gap-px overflow-hidden rounded-(--radius-panel) border border-border bg-border">
        <li className="bg-surface px-5 py-4">
          <Badge tone="verified">verified</Badge>
          <p className="mt-2 text-[0.95rem] text-muted">
            Signed by a bound device, carries a receipt stream, and passed every check. Counts in
            full on leaderboards, mints at full rate, settles markets.
          </p>
        </li>
        <li className="bg-surface px-5 py-4">
          <Badge tone="reported">reported</Badge>
          <p className="mt-2 text-[0.95rem] text-muted">
            Signed by a bound device, no receipt stream we can lean on. Agents whose transcripts
            have no per-message identifiers we can read land here, and so does a day whose receipts
            do not fit its tokens. It counts on leaderboards with the badge attached, and mints at
            half.
          </p>
        </li>
        <li className="bg-surface px-5 py-4">
          <Badge tone="quarantined">quarantined</Badge>
          <p className="mt-2 text-[0.95rem] text-muted">
            A row an admin kept out, with the reasons attached. Out of leaderboards, out of the
            mint, and out of market resolution until an admin approves it. Uploads are no longer
            quarantined: a number no real usage can produce is refused instead. Approving a day
            only ever adds credits: a day already minted is never clawed back.
          </p>
        </li>
      </ul>

      <div className="signal-rail my-10" aria-hidden />

      <h2 className="type-heading">Receipt streams</h2>
      <p className="mt-3 text-[0.95rem] text-muted">
        A receipt stream is a sorted list of unique hashes identifying the messages or billed
        turns behind a day&apos;s usage. The collector reads these identifiers from Claude Code,
        Codex, Grok, Pi, and OpenCode. It also creates receipts from Cursor account usage.
        It sends only hashes, without content, prompts, or file names.
      </p>
      <p className="mt-3 text-[0.95rem] text-muted">Two things fall out of that:</p>
      <ul className="mt-3 space-y-2 text-[0.95rem] text-muted">
        <li>
          Deduplication. Two machines reading the same transcripts, a laptop and a desktop over a
          synced folder, produce the same hashes, so the day is counted once.
        </li>
        <li>
          Coherence. The number of receipts and the tokens attributed to them have to fit each
          other. A day with enormous totals and a handful of receipts does not, and neither does a
          day with more receipts than its tokens account for. Either way the stream is not
          evidence, so the day counts as reported instead of verified.
        </li>
      </ul>

      <div className="signal-rail my-10" aria-hidden />

      <h2 className="type-heading">The checks</h2>
      <p className="mt-3 text-[0.95rem] text-muted">
        Only a number no real usage can produce is refused. Size is not one of them: a short
        prompt can ask for a long answer, and an API loop can run all day. Heavy usage counts in
        full.
      </p>
      <dl className="mt-6 grid gap-4">
        {checks.map(([name, detail]) => (
          <div key={name} className="border-t border-border-faint pt-3">
            <dt className="type-data text-[0.92rem] text-foreground">{name}</dt>
            <dd className="mt-1 text-[0.95rem] text-muted">{detail}</dd>
          </div>
        ))}
      </dl>

      <div className="signal-rail my-10" aria-hidden />

      <h2 className="type-heading">Syncing history again</h2>
      <p className="mt-3 text-[0.95rem] text-muted">
        Every sync sends the last few days. Older days change only when a sync reads them again,
        with <code className="type-data">--since N</code> or <code className="type-data">--all</code>.
        The server then adds the days it does not have. It replaces a day it has when the new
        reading saw at least the same messages, or reports at least as many tokens. That is how a
        corrected estimate lands. The last few days always take the latest reading, because they
        are still being written. An older day never goes down because old transcripts were deleted
        from your machine.
      </p>
      <p className="mt-3 text-[0.95rem] text-muted">
        One machine counts once. Reconnecting a machine keeps its device. If you connected one
        machine more than once, mark those devices as the same machine in{" "}
        <Link href="/settings" className="text-primary-text hover:underline">
          settings
        </Link>
        . Each day then counts once for that machine, from the most complete copy. Different
        machines always add up.
      </p>

      <div className="signal-rail my-10" aria-hidden />

      <h2 className="type-heading">What this does not give you</h2>
      <p className="mt-3 text-[0.95rem] text-muted">
        A determined person can still fabricate a coherent stream. We know. Two things keep that
        from mattering much: the stakes are play money with no way in or out, and your community
        can see your board. If a number looks wrong to the people who know you, it probably is.
      </p>
      <p className="mt-3 text-[0.95rem] text-muted">
        The reasoning behind all of this is in{" "}
        <a
          className="text-primary-text hover:underline"
          href="https://github.com/formidable-oss/tokenburnmarket/blob/main/docs/adr/0003-receipt-streams-and-trust-levels.md"
        >
          ADR 0003
        </a>{" "}
        and{" "}
        <a
          className="text-primary-text hover:underline"
          href="https://github.com/formidable-oss/tokenburnmarket/blob/main/docs/adr/0006-history-resync-machines-and-impossible-numbers.md"
        >
          ADR 0006
        </a>
        . What a trust level is worth in credits is on the{" "}
        <Link href="/docs/credits" className="text-primary-text hover:underline">
          credits
        </Link>{" "}
        page.
      </p>
    </article>
  );
}
