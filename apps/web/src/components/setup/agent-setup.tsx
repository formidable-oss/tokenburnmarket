"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CommandLine } from "@/components/ui/command-line";

export function AgentSetup({
  prompt,
  manualHref = "/docs/setup#manual",
  showManual = true,
}: {
  prompt: string;
  manualHref?: string;
  showManual?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    let succeeded = false;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(prompt);
        succeeded = true;
      }
    } catch {
      /* Fall through to selection copy for restricted clipboard contexts. */
    }

    if (!succeeded) {
      const input = document.createElement("textarea");
      input.value = prompt;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.inset = "-9999px auto auto -9999px";
      document.body.appendChild(input);
      input.select();
      succeeded = document.execCommand("copy");
      input.remove();
    }

    if (succeeded) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }
  }

  return (
    <section
      aria-labelledby="agent-setup-title"
      className="overflow-hidden rounded-(--radius-panel) border border-primary-border bg-primary-subtle"
    >
      <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[0.72fr_1.28fr] lg:gap-10 lg:p-8">
        <div>
          <p className="type-label text-primary-text">recommended setup</p>
          <h2 id="agent-setup-title" className="type-heading mt-3">
            Give this prompt to your agent.
          </h2>
          <p className="mt-4 max-w-[38ch] text-[0.95rem] text-muted">
            It installs the collector, uploads your usage, and keeps it synced every 15 minutes.
            You approve one browser prompt.
          </p>
          <Button type="button" onClick={copy} className="mt-6 w-full sm:w-auto">
            {copied ? "Copied" : "Copy prompt"}
          </Button>
          <p className="mt-3 text-[0.78rem] text-subtle" aria-live="polite">
            {copied
              ? "Paste it into the agent on the machine you want to track."
              : "Use an agent with terminal access."}
          </p>
        </div>

        <pre className="type-data max-h-[25rem] overflow-auto whitespace-pre-wrap rounded-(--radius-panel) border border-border-strong bg-surface-sunken p-4 text-[0.78rem] leading-6 text-foreground sm:p-5">
          {prompt}
        </pre>
      </div>

      {showManual ? (
        <details className="border-t border-primary-border px-5 py-4 sm:px-7 lg:px-8">
          <summary className="cursor-pointer text-sm text-muted hover:text-foreground">
            Set up manually instead
          </summary>
          <div className="mt-4 max-w-[34rem]">
            <CommandLine command="npx -y tokenburnmarket@latest connect" />
            <p className="mt-3 text-[0.85rem] text-muted">
              Prefer the terminal? Connect once here, then add monitoring and MCP from the guide.{" "}
              <Link href={manualHref} className="text-primary-text hover:underline">
                Open the guide
              </Link>
              .
            </p>
          </div>
        </details>
      ) : null}
    </section>
  );
}
