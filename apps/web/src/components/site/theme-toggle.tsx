"use client";

import { useSyncExternalStore } from "react";
import { MoonIcon, SunIcon } from "@/components/ui/icons";

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

  /*
    The icon shows the mode you are in, moon for dark and sun for light. CSS
    picks it from data-theme, so the right one is there before hydration.
  */
  const icon = "absolute transition-[opacity,transform] duration-200 ease-(--ease-out-expo)";

  return (
    <button
      type="button"
      onClick={toggle}
      className="relative flex size-10 shrink-0 items-center justify-center rounded-(--radius-control) border border-border-strong text-muted transition-colors hover:border-primary-border hover:bg-primary-subtle hover:text-foreground"
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      <MoonIcon className={`${icon} theme-light:-rotate-90 theme-light:scale-50 theme-light:opacity-0`} />
      <SunIcon className={`${icon} rotate-90 scale-50 opacity-0 theme-light:rotate-0 theme-light:scale-100 theme-light:opacity-100`} />
    </button>
  );
}
