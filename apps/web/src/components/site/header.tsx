import Image from "next/image";
import Link from "next/link";
import { auth } from "@/auth";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./theme-toggle";

const nav = [
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/communities", label: "Communities" },
  { href: "/markets", label: "Markets" },
  { href: "/docs", label: "Docs" },
];

export async function SiteHeader() {
  const session = await auth();
  const handle = session?.user?.handle;

  return (
    <header className="sticky top-0 z-40 border-b border-border-faint bg-[color:var(--backdrop)] backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-6 px-4 sm:px-6 lg:px-12">
        <Link href="/" className="rounded-sm" aria-label="tokenburnmarket home">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-5 text-sm text-muted sm:flex" aria-label="Primary">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="nav-link hover:text-foreground">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          {handle ? (
            <>
              <Link
                href="/settings"
                className="nav-link hidden px-2 text-[0.82rem] text-muted hover:text-foreground sm:block"
              >
                Settings
              </Link>
              <Link
                href={`/@${handle}`}
                className="flex h-9 items-center gap-2 rounded-(--radius-control) px-2 hover:bg-surface-raised"
              >
                {session?.user?.image ? (
                  <Image
                    src={session.user.image}
                    alt=""
                    width={22}
                    height={22}
                    className="rounded-full border border-border"
                    unoptimized
                  />
                ) : null}
                <span className="type-data text-[0.82rem]">{handle}</span>
              </Link>
            </>
          ) : (
            <Button as={Link} href="/signin" variant="secondary" className="h-9 px-3 text-[0.82rem]">
              Sign in with GitHub
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
