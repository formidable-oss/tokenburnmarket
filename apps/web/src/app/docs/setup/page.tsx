import type { Metadata } from "next";
import Link from "next/link";
import { AgentSetup } from "@/components/setup/agent-setup";
import { CommandLine } from "@/components/ui/command-line";
import { agentSetupPrompt } from "@/lib/setup-prompt";

export const metadata: Metadata = {
  title: "Setup",
  description: "Give your coding agent one prompt to install tokenburnmarket and keep usage synced.",
  alternates: { canonical: "/docs/setup" },
};

/*
  Every command and every config block on this page is what packages/cli prints.
  If the CLI changes what it says, change it here in the same PR.
*/
const codexConfig = `[mcp_servers.tokenburnmarket]
command = "npx"
args = ["-y", "tokenburnmarket", "mcp"]`;

export default function DocsSetupPage() {
  return (
    <article>
      <p className="type-label">docs / setup</p>
      <h1 className="type-heading mt-3">Paste this into your agent.</h1>
      <p className="mt-4 text-[1.05rem] text-muted">
        We upload token counts, cost, and hashed message IDs. Prompts and paths stay on your
        machine.
      </p>

      <div className="mt-8">
        <AgentSetup prompt={agentSetupPrompt()} showManual={false} />
      </div>

      <div className="signal-rail my-10" aria-hidden />

      <details id="manual" className="rounded-(--radius-panel) border border-border bg-surface p-5 sm:p-6">
        <summary className="type-heading cursor-pointer">Manual setup</summary>
        <div className="mt-6">
          <h2 className="type-label">connect</h2>
          <p className="mt-3 text-[0.95rem] text-muted">
            Sign in first, then run this on the machine you code on.
          </p>
          <div className="mt-4 max-w-[30rem]">
            <CommandLine command="npx -y tokenburnmarket@latest connect" />
          </div>
          <p className="mt-4 text-[0.95rem] text-muted">
            The CLI prints an approval URL, fingerprint, and 10-minute code. Match the browser
            fingerprint to the terminal, then approve. The private key stays on your machine.
          </p>
          <p className="mt-3 text-[0.95rem] text-muted">
            Approval starts the first sync. A large history can take about 30 seconds.
          </p>
          <p className="mt-3 text-[0.95rem] text-muted">
            Reconnecting replaces the local device. Revoke the old one in{" "}
            <Link href="/settings" className="text-primary-text hover:underline">
              settings
            </Link>
            . Separate devices that read the same transcripts are counted once.
          </p>
        </div>
      </details>

      <div className="signal-rail my-10" aria-hidden />

      <h2 className="type-heading">Sync</h2>
      <p className="mt-3 text-[0.95rem] text-muted">
        A sync uploads changed daily totals and receipt hashes.
      </p>
      <div className="mt-4 grid max-w-[34rem] gap-2">
        <CommandLine command="npx tokenburnmarket sync" />
        <CommandLine command="npx tokenburnmarket sync --since 7" />
        <CommandLine command="npx tokenburnmarket sync --dry-run" />
        <CommandLine command="npx tokenburnmarket status" />
      </div>
      <dl className="mt-6 grid gap-3 text-[0.95rem] text-muted">
        <div className="flex gap-4">
          <dt className="type-data w-28 shrink-0 text-foreground">sync</dt>
          <dd>The days since the last sync.</dd>
        </div>
        <div className="flex gap-4">
          <dt className="type-data w-28 shrink-0 text-foreground">--since 7</dt>
          <dd>The last seven days instead, whatever the watermark says.</dd>
        </div>
        <div className="flex gap-4">
          <dt className="type-data w-28 shrink-0 text-foreground">--dry-run</dt>
          <dd>Prints what would go up and sends nothing.</dd>
        </div>
        <div className="flex gap-4">
          <dt className="type-data w-28 shrink-0 text-foreground">--quiet</dt>
          <dd>Prints nothing unless something went wrong. For cron lines and scripts.</dd>
        </div>
        <div className="flex gap-4">
          <dt className="type-data w-28 shrink-0 text-foreground">status</dt>
          <dd>Handle, device, server, and the last day synced from this machine.</dd>
        </div>
      </dl>

      <div className="signal-rail my-10" aria-hidden />

      <h2 className="type-heading">Keep it synced</h2>
      <p className="mt-3 text-[0.95rem] text-muted">
        Add the MCP server to Claude Code or Codex. It syncs when your agent starts and adds the
        trading tools below.
      </p>
      <div className="mt-4 max-w-[38rem]">
        <CommandLine command="claude mcp add tokenburnmarket -- npx -y tokenburnmarket mcp" />
      </div>
      <p className="mt-5 text-[0.95rem] text-muted">
        Codex gets the same from <span className="type-data">~/.codex/config.toml</span>:
      </p>
      <pre className="type-data mt-4 max-w-[38rem] overflow-x-auto rounded-(--radius-panel) border border-border bg-surface-sunken p-4 text-[0.88rem] text-foreground">
        {codexConfig}
      </pre>
      <p className="mt-5 text-[0.95rem] text-muted">
        A startup sync skips work if another sync ran in the past ten minutes. This keeps two open
        agents from reading the same transcripts twice.{" "}
        <span className="type-data">npx tokenburnmarket mcp setup</span> prints both of these again
        when the terminal has scrolled away.
      </p>

      <h3 className="type-label mt-8">no agent on this machine</h3>
      <p className="mt-3 text-[0.95rem] text-muted">
        Run the daemon. Its lock file allows one copy per machine.
      </p>
      <div className="mt-4 grid max-w-[30rem] gap-2">
        <CommandLine command="npx tokenburnmarket daemon --interval 15m" />
        <CommandLine command="npx tokenburnmarket daemon install" />
      </div>
      <p className="mt-4 text-[0.95rem] text-muted">
        <span className="type-data">daemon install</span> prints the launchd job or the systemd
        user unit for this machine, pointing at this node and this script. It prints; it never
        writes.
      </p>

      <div className="signal-rail my-10" aria-hidden />

      <h2 className="type-heading">MCP tools</h2>
      <table className="mt-6 w-full border-collapse text-left text-[0.92rem]">
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="type-label py-2 pr-4 font-normal">
              tool
            </th>
            <th scope="col" className="type-label py-2 font-normal">
              what it does
            </th>
          </tr>
        </thead>
        <tbody className="text-muted">
          {[
            ["sync_usage", "uploads this machine's usage and reports what the server made of it"],
            ["my_stats", "today, this week and this month of spend and tokens, credits, trust"],
            ["my_communities", "the communities you belong to"],
            ["list_markets", "open markets you can trade, with the price of every outcome"],
            ["place_bet", "quotes a trade, and places it only with confirm: true"],
          ].map(([tool, what]) => (
            <tr key={tool} className="border-b border-border-faint">
              <td className="type-data py-2.5 pr-4 align-top text-foreground">{tool}</td>
              <td className="py-2.5 align-top">{what}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-5 text-[0.95rem] text-muted">
        <span className="type-data">place_bet</span> never spends without{" "}
        <span className="type-data">confirm: true</span>. Called without it, it prices the trade
        against the live book, writes nothing, and returns the cost, the average price and where
        the price would land. See{" "}
        <Link href="/docs/markets" className="text-primary-text hover:underline">
          markets
        </Link>{" "}
        for what happens when the price moves between the quote and the fill.
      </p>

      <div className="signal-rail my-10" aria-hidden />

      <h2 className="type-heading">Where things are stored</h2>
      <p className="mt-3 text-[0.95rem] text-muted">
        Config lives in the platform config directory:{" "}
        <span className="type-data">~/Library/Application Support/tokenburnmarket</span> on macOS,{" "}
        <span className="type-data">%APPDATA%\tokenburnmarket</span> on Windows,{" "}
        <span className="type-data">$XDG_CONFIG_HOME/tokenburnmarket</span> elsewhere. It holds a
        device token and a private key, and is written owner-only.
      </p>
      <p className="mt-3 text-[0.95rem] text-muted">
        <span className="type-data">TBM_SERVER</span> points the collector at another server, the
        same as <span className="type-data">--server</span>.{" "}
        <span className="type-data">TBM_CCUSAGE</span> names a local ccusage command to run instead
        of <span className="type-data">npx -y ccusage@latest</span>.{" "}
        <span className="type-data">npx tokenburnmarket --help</span> lists every command.
      </p>
    </article>
  );
}
