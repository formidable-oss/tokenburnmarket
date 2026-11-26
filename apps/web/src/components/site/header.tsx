import Image from "next/image";
import Link from "next/link";
import { auth } from "@/auth";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { GitHubIcon } from "@/components/ui/icons";
import { isAdmin } from "@/lib/admin";
import { NavLinks } from "./nav-links";
import { ThemeToggle } from "./theme-toggle";

export async function SiteHeader() {
  const session = await auth();
  const handle = session?.user?.handle;

  /* Settings and Admin sit in the bar when it has room, and in the second row when it does not. */
  const account = handle
    ? [
        ...(isAdmin(handle) ? [{ href: "/admin", label: "Admin" }] : []),
        { href: "/settings", label: "Settings" },
      ]
    : [];

  return (
    <header className="sticky top-0 z-40 border-b border-border-faint bg-[color:var(--backdrop)] backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-2 px-4 sm:gap-6 sm:px-6 lg:px-12">
        <Link href="/" className="flex items-center rounded-sm" aria-label="tokenburnmarket home">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-5 text-sm text-muted lg:flex" aria-label="Primary">
          <NavLinks />
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {handle ? (
            <>
              {account.map((a) => (
                <Link
                  key={a.href}
                  href={a.href}
                  className="nav-link hidden px-2 text-[0.82rem] text-muted hover:text-foreground lg:block"
                >
                  {a.label}
                </Link>
              ))}
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
                ) : (
                  <span
                    aria-hidden
                    className="type-data flex size-[22px] items-center justify-center rounded-full border border-border bg-surface-sunken text-[0.7rem]"
                  >
                    {handle.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="type-data hidden text-[0.82rem] min-[420px]:inline">{handle}</span>
              </Link>
            </>
          ) : (
            <Button as={Link} href="/signin" variant="secondary" className="h-9 px-2.5 text-[0.78rem] sm:px-3 sm:text-[0.82rem]">
              <GitHubIcon />
              <span>
                {/* With the icon, the full label needs 440px. Below that it would scroll the page sideways. */}
                Sign in<span className="hidden min-[440px]:inline"> with GitHub</span>
              </span>
            </Button>
          )}
        </div>
      </div>

      {/* Below 1024px the bar has no room for the links, so they take a second row. */}
      <nav className="border-t border-border-faint lg:hidden" aria-label="Primary">
        <div className="mx-auto flex h-11 max-w-[1200px] items-center gap-5 overflow-x-auto px-4 text-sm text-muted sm:px-6">
          <NavLinks />
          {account.length > 0 ? (
            <span className="ml-auto flex shrink-0 gap-5">
              {account.map((a) => (
                <Link key={a.href} href={a.href} className="nav-link hover:text-foreground">
                  {a.label}
                </Link>
              ))}
            </span>
          ) : null}
        </div>
      </nav>
    </header>
  );
}
