"use client";

/*
  The primary links, with the section you are in marked by aria-current. The
  header is a server component and cannot read the path, so this small client
  part does it. The underline and the color come from `.nav-link` in globals.css.
*/
import Link from "next/link";
import { usePathname } from "next/navigation";

const nav = [
  { href: "/leaderboard", label: "Leaderboard", under: ["/leaderboard"] },
  { href: "/communities", label: "Communities", under: ["/communities", "/c/", "/join/"] },
  { href: "/markets", label: "Markets", under: ["/markets", "/m/"] },
  { href: "/docs", label: "Docs", under: ["/docs"] },
];

export function NavLinks() {
  const path = usePathname();

  return nav.map((n) => {
    const inSection = n.under.some((prefix) => path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`));
    // "page" only on the link's own page. Inside the section, such as /docs/setup, the link is the current section.
    const current = path === n.href ? "page" : inSection ? "true" : undefined;
    return (
      <Link
        key={n.href}
        href={n.href}
        aria-current={current}
        className="nav-link shrink-0 hover:text-foreground [&[aria-current]]:text-foreground"
      >
        {n.label}
      </Link>
    );
  });
}
