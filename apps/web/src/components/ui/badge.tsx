/*
  Trust and status badges. Color never carries meaning alone: every badge has a word.
  verified: signed device + receipt stream + checks passed
  reported: signed device, no receipt stream (agents we cannot read identifiers for)
  quarantined: failed a check, out of boards and mint until reviewed
  won: settled in the holder's favor
*/
type Tone = "verified" | "reported" | "quarantined" | "won" | "neutral";

const tones: Record<Tone, string> = {
  verified: "border-primary-border text-primary-text",
  reported: "border-border-strong text-muted",
  quarantined: "border-[color:var(--ember)] text-[color:var(--ember)]",
  won: "border-[color:var(--won)] text-[color:var(--won)]",
  neutral: "border-border text-subtle",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span
      className={`type-label inline-flex h-5 items-center rounded-[3px] border px-1.5 text-[0.62rem] leading-none ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
