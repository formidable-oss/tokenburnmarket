"use client";

import { useState } from "react";

/*
  A one-line terminal command with a copy affordance.
  Copy feedback is inline text, not a toast: it is the only feedback needed here.
*/
export function CommandLine({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable: the text is still selectable */
    }
  }

  return (
    <div className="flex h-11 items-stretch overflow-hidden rounded-(--radius-control) border border-border-strong bg-surface-sunken">
      <span aria-hidden className="type-data flex items-center pl-3.5 text-subtle select-none">$</span>
      <code className="type-data flex flex-1 items-center px-2.5 text-[0.92rem] text-foreground">
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        className="type-label border-l border-border-strong px-3 text-[0.66rem] text-muted transition-colors hover:bg-primary-subtle hover:text-primary-text"
        aria-live="polite"
      >
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}
