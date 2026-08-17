"use client";

import { useSyncExternalStore } from "react";

/*
  Explicit light/dark choice stored in localStorage under "tbm-theme".
  The inline script in layout.tsx applies the stored value before paint, so this
  component only has to keep the attribute and the label in sync after hydration.
*/
const KEY = "tbm-theme";

const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function read(): "dark" | "light" {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, read, () => "dark");

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem(KEY, next);
    listeners.forEach((l) => l());
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="type-label h-10 rounded-(--radius-control) px-2.5 text-[0.66rem] text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      {theme === "dark" ? "day" : "night"}
    </button>
  );
}
