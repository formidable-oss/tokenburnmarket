"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function ManualSetup({ children }: { children: ReactNode }) {
  const details = useRef<HTMLDetailsElement>(null);

  // On load and on in-page links: not every browser opens a closed <details> for a fragment.
  useEffect(() => {
    const openForHash = () => {
      if (window.location.hash === "#manual" && details.current) {
        details.current.open = true;
        details.current.querySelector("#manual")?.scrollIntoView();
      }
    };
    openForHash();
    window.addEventListener("hashchange", openForHash);
    return () => window.removeEventListener("hashchange", openForHash);
  }, []);

  // Fragment navigation can open the native disclosure before React hydrates it.
  return (
    <details ref={details} suppressHydrationWarning className="rounded-(--radius-panel) border border-border bg-surface p-5 sm:p-6">
      <summary className="type-heading cursor-pointer">Set up manually instead · 3 steps</summary>
      <div id="manual" className="mt-6 scroll-mt-20">{children}</div>
    </details>
  );
}
