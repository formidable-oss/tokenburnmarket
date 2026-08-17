import type { Metadata } from "next";
import Link from "next/link";
import { CommandLine } from "@/components/ui/command-line";
import { DOCS_PAGES } from "./pages";

export const metadata: Metadata = {
  title: "Docs",
  description:
    "How tokenburnmarket works: connecting a machine, how usage is verified, how markets are priced and resolved, and how credits are minted.",
  alternates: { canonical: "/docs" },
};

export default function DocsIndexPage() {
  return (
    <article>
      <p className="type-label">docs</p>
      <h1 className="type-heading mt-3">How this works.</h1>
      <p className="mt-4 text-[1.05rem] text-muted">
        Four pages. Setup is the only one you need before you can play. The other three explain
        what the numbers mean and how they settle.
      </p>

      <div className="mt-8 max-w-[30rem]">
        <CommandLine command="npx tokenburnmarket connect" />
      </div>

      <div className="signal-rail my-10" aria-hidden />

      <ul className="grid gap-px overflow-hidden rounded-(--radius-panel) border border-border bg-border">
        {DOCS_PAGES.filter((page) => page.href !== "/docs").map((page) => (
          <li key={page.href} className="bg-surface">
            <Link href={page.href} className="block px-5 py-4 hover:bg-surface-raised">
              <span className="type-data text-[0.95rem] text-foreground">{page.label}</span>
              <span className="mt-1 block text-[0.9rem] text-muted">{page.blurb}</span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="signal-rail my-10" aria-hidden />

      <h2 className="type-label">the short version</h2>
      <ol className="mt-4 space-y-3 text-[0.95rem] text-muted">
        <li>
          <span className="text-foreground">1.</span> One command binds your machine. Only token
          counts, cost, and hashes of message identifiers leave it.
        </li>
        <li>
          <span className="text-foreground">2.</span> Each closed day mints credits from what your
          agents cost, on a curve that flattens for whales.
        </li>
        <li>
          <span className="text-foreground">3.</span> You bet credits on who burns what next.
          Markets resolve from the same usage, automatically.
        </li>
      </ol>

      <p className="mt-8 border-l-2 border-ember pl-5 text-[1.05rem]">
        Verified means signed and plausible. <span className="text-muted">Not proof.</span>
      </p>
    </article>
  );
}
