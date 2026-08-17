"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS_PAGES } from "./pages";

/*
  The rail beside every docs page. Client only so it can mark the page you are
  on; the pages themselves render on the server.
*/
export function DocsNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Docs"
      className="type-data flex flex-wrap gap-x-5 gap-y-2 text-[0.85rem] lg:flex-col lg:gap-2.5"
    >
      {DOCS_PAGES.map((page) => {
        const active = page.href === pathname;
        return (
          <Link
            key={page.href}
            href={page.href}
            aria-current={active ? "page" : undefined}
            className={active ? "text-primary-text" : "text-muted hover:text-foreground"}
          >
            {page.label}
          </Link>
        );
      })}
    </nav>
  );
}
