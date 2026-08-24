import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth, devSignInHandle, signIn } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { safeInternalPath } from "@/lib/profile";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in with GitHub to claim your handle, connect a machine and turn your agent usage into credits.",
};

export default async function SignInPage({ searchParams }: PageProps<"/signin">) {
  const { next } = await searchParams;
  const redirectTo = safeInternalPath(typeof next === "string" ? next : null, "/settings");

  const session = await auth();
  if (session?.user?.handle) redirect(`/@${session.user.handle}`);

  return (
    <section className="mx-auto grid max-w-[1200px] gap-12 px-4 pb-24 pt-16 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16 lg:px-12 lg:pt-24">
      <div>
        <p className="type-label rise" style={{ "--i": 0 } as React.CSSProperties}>
          step one of three
        </p>
        <h1 className="type-heading rise mt-4" style={{ "--i": 1 } as React.CSSProperties}>
          Claim your handle.
        </h1>
        <p className="rise mt-4 max-w-[38ch] text-[0.95rem] text-muted" style={{ "--i": 2 } as React.CSSProperties}>
          GitHub is the only sign-in. Your handle is your GitHub login, and your profile lives at
          /@yourhandle. We read your public login and avatar, nothing else.
        </p>
      </div>

      <div
        className="rise rounded-(--radius-panel) border border-border bg-surface p-6 sm:p-8"
        style={{ "--i": 2 } as React.CSSProperties}
      >
        {devSignInHandle ? (
          <form
            action={async () => {
              "use server";
              await signIn("dev", { redirectTo });
            }}
          >
            <div className="flex items-center gap-2">
              <Badge tone="neutral">development</Badge>
              <span className="type-data text-[0.78rem] text-subtle">no OAuth app configured</span>
            </div>
            <p className="mt-4 text-[0.95rem] text-muted">
              This machine has no GitHub credentials, so sign-in is faked locally as{" "}
              <span className="type-data text-foreground">{devSignInHandle}</span>. This path does not
              exist in production.
            </p>
            <Button type="submit" className="mt-6 w-full sm:w-auto">
              Sign in as {devSignInHandle}
            </Button>
          </form>
        ) : (
          <form
            action={async () => {
              "use server";
              await signIn("github", { redirectTo });
            }}
          >
            <p className="type-label">sign in</p>
            <p className="mt-4 max-w-[42ch] text-[0.95rem] text-muted">
              One click. No password, no email. Sign out any time from settings.
            </p>
            <Button type="submit" className="mt-6 w-full sm:w-auto">
              Sign in with GitHub
            </Button>
          </form>
        )}

        <div className="signal-rail my-7" aria-hidden />
        <p className="text-[0.85rem] text-subtle">
          Next, paste one prompt into your coding agent. It sets up usage sync.
        </p>
      </div>
    </section>
  );
}
