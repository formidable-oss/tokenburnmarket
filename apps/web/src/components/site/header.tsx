import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./theme-toggle";

const nav = [
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/markets", label: "Markets" },
  { href: "/docs", label: "Docs" },
];

export function SiteHeader() {
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
          <Button as={Link} href="/signin" variant="secondary" className="h-9 px-3 text-[0.82rem]">
            Sign in with GitHub
          </Button>
        </div>
      </div>
    </header>
  );
}
