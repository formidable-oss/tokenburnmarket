import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fingerprintOf, readConnectCode } from "@/lib/connect";
import { connectCodeState, normalizeConnectCode } from "@/lib/connect-codes";
import { approveDevice, rejectDevice } from "./actions";

export const metadata: Metadata = {
  title: "Approve a device",
  description: "Bind the machine that printed this code to your account.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const panel = "rounded-(--radius-panel) border border-border bg-surface p-6 sm:p-8";

/** One shell for every outcome, so the page never jumps between layouts. */
function Shell({ step, title, children }: { step: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mx-auto grid max-w-[1200px] gap-12 px-4 pb-24 pt-16 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16 lg:px-12 lg:pt-24">
      <div>
        <p className="type-label rise" style={{ "--i": 0 } as React.CSSProperties}>
          {step}
        </p>
        <h1 className="type-heading rise mt-4" style={{ "--i": 1 } as React.CSSProperties}>
          {title}
        </h1>
        <p
          className="rise mt-4 max-w-[38ch] text-[0.95rem] text-muted"
          style={{ "--i": 2 } as React.CSSProperties}
        >
          A device signs everything it uploads. Approving binds its key to your account, and you can
          revoke it from settings at any time.
        </p>
      </div>
      <div className={`rise ${panel}`} style={{ "--i": 2 } as React.CSSProperties}>
        {children}
      </div>
    </section>
  );
}

function Dead({ title, message }: { title: string; message: string }) {
  return (
    <Shell step="connect a device" title={title}>
      <p className="text-[0.95rem] text-muted">{message}</p>
      <div className="signal-rail my-7" aria-hidden />
      <p className="type-data text-[0.85rem] text-subtle">$ npx tokenburnmarket connect</p>
    </Shell>
  );
}

export default async function ConnectPage({ params, searchParams }: PageProps<"/connect/[code]">) {
  const { code: rawCode } = await params;
  const { done } = await searchParams;
  const code = normalizeConnectCode(rawCode);

  if (done === "approved") {
    return (
      <Shell step="connect a device" title="Device approved.">
        <div className="flex items-center gap-2">
          <Badge tone="verified">approved</Badge>
          <span className="type-data text-[0.78rem] text-subtle">{code}</span>
        </div>
        <p className="mt-4 text-[0.95rem] text-muted">
          Back to your terminal. It is syncing this machine now, which takes a moment the first
          time, then it prints the link to your profile and how to keep it synced.
        </p>
        <div className="signal-rail my-7" aria-hidden />
        <Button as={Link} href="/settings" variant="secondary">
          See your devices
        </Button>
      </Shell>
    );
  }

  if (done === "rejected") {
    return <Dead title="Rejected." message="Nothing was bound. The command on that machine will stop with an error." />;
  }

  if (!code) {
    return <Dead title="Not a code." message="Connect codes look like ABCD-2345. Check the one your terminal printed." />;
  }

  const session = await auth();
  if (!session?.user?.id) redirect(`/signin?next=/connect/${code}`);

  const row = await readConnectCode(code);
  if (connectCodeState(row, new Date()) !== "pending" || !row) {
    return (
      <Dead
        title="This code is done."
        message="Codes last ten minutes and work once. Run the connect command again for a fresh one."
      />
    );
  }

  return (
    <Shell step="connect a device" title="Approve this device?">
      <dl className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-3">
        <dt className="type-label self-center">device</dt>
        <dd className="type-data text-[0.95rem] text-foreground">{row.deviceName}</dd>
        <dt className="type-label self-center">code</dt>
        <dd className="type-data text-[0.95rem] text-foreground">{row.code}</dd>
        <dt className="type-label self-center">fingerprint</dt>
        <dd className="type-data text-[0.95rem] text-foreground">
          {fingerprintOf(row.devicePubkey)}
        </dd>
      </dl>

      <p className="mt-6 text-[0.85rem] text-subtle">
        The same fingerprint is printed on the machine that asked. If it does not match, reject.
      </p>

      <div className="signal-rail my-7" aria-hidden />

      <div className="flex flex-wrap items-center gap-3">
        <form action={approveDevice}>
          <input type="hidden" name="code" value={row.code} />
          <Button type="submit">Approve</Button>
        </form>
        <form action={rejectDevice}>
          <input type="hidden" name="code" value={row.code} />
          <Button type="submit" variant="secondary">
            Reject
          </Button>
        </form>
        <span className="type-data text-[0.78rem] text-subtle">signed in as {session.user.handle}</span>
      </div>
    </Shell>
  );
}
