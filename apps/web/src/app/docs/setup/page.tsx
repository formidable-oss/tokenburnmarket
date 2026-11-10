import type { Metadata } from "next";
import Link from "next/link";
import { SYNC_SLOT_TIMES } from "@tokenburnmarket/core";
import { AgentSetup } from "@/components/setup/agent-setup";
import { ManualSetup } from "@/components/setup/manual-setup";
import { CommandLine } from "@/components/ui/command-line";
import { agentSetupPrompt } from "@/lib/setup-prompt";

export const metadata: Metadata = {
  title: "Setup",
  description: "Give your coding agent one prompt to install tokenburnmarket and keep usage synced.",
  alternates: { canonical: "/docs/setup" },
};

/*
  Setup commands and MCP configuration follow packages/cli.
  Service restart commands match the names installed by the CLI.
*/
const codexConfig = `[mcp_servers.tokenburnmarket]
command = "npx"
args = ["-y", "tokenburnmarket", "mcp"]`;

export default function DocsSetupPage() {
  return (
    <article>
      <p className="type-label">docs / setup</p>
      <h1 className="type-heading mt-3">Connect a computer.</h1>
      <p className="mt-4 text-[1.05rem] text-muted">
        Set up each computer once. Signing in to the website does not connect it.
        Run the setup on the computer whose usage you want to track.
      </p>
      <p className="mt-4 text-[1.05rem] text-muted">
        We upload token counts, cost, and hashed message IDs. Prompts and paths stay on your
        machine.
      </p>
      <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-primary-text">
        <a href="#manual" className="hover:underline">New computer: manual setup</a>
        <Link href="#update" className="hover:underline">Already connected: update and sync</Link>
      </div>

      <div className="mt-8">
        <AgentSetup prompt={agentSetupPrompt()} showManual={false} />
      </div>

      <div className="signal-rail my-10" aria-hidden />

      <ManualSetup>
        <h2 className="type-label">1. install the CLI</h2>
        <p className="mt-3 text-[0.95rem] text-muted">
          Requires Node.js 22.15 or newer. Check your version, then install the CLI.
        </p>
        <div className="mt-4 grid max-w-[38rem] gap-2">
          <CommandLine command="node --version" />
          <CommandLine command="npm install --global tokenburnmarket@latest" />
        </div>
        <p className="mt-4 text-[0.95rem] text-muted">
          Use a user-owned npm prefix. Do not use sudo. Verify the installed command with{" "}
          <span className="type-data">command -v tokenburnmarket</span> on macOS/Linux or{" "}
          <span className="type-data">Get-Command tokenburnmarket</span> in PowerShell.
          Make sure the global executable directory is on your PATH and the command resolves
          outside an npx cache.
        </p>

        <h2 className="type-label mt-8">2. connect and approve this computer</h2>
        <div className="mt-4 max-w-[38rem]">
          <CommandLine command="tokenburnmarket connect" />
        </div>
        <p className="mt-3 text-[0.95rem] text-muted">
          Open the approval URL printed in the terminal and sign in with GitHub if asked. Match
          the browser fingerprint to the terminal, approve, then confirm the account in the terminal
          if asked. The code lasts ten minutes. The private key stays on this computer.
        </p>
        <p className="mt-3 text-[0.95rem] text-muted">
          Connection uploads all available history on a new computer. Wait for the first upload
          to finish before continuing. If the upload fails, run{" "}
          <span className="type-data">tokenburnmarket sync</span>.
        </p>

        <h2 className="type-label mt-8">3. enable automatic sync and check it</h2>
        <div className="mt-4 grid max-w-[38rem] gap-2">
          <CommandLine command="tokenburnmarket daemon install" />
          <CommandLine command="tokenburnmarket status" />
        </div>
        <p className="mt-3 text-[0.95rem] text-muted">
          The daemon installs and starts a background service. It runs independently of your
          coding agent at {SYNC_SLOT_TIMES} while this computer is running. Check that the install
          reports success and that status shows your handle, this device, and a last sync time.
          On macOS, the install output shows the log path for checking sync errors.
        </p>
        <p className="mt-3 text-[0.95rem] text-muted">
          If this computer has no eligible history and sync reports &quot;Nothing to sync.&quot;,
          &quot;Synced to&quot; and &quot;Last sync&quot; may show &quot;never&quot;. The computer
          is connected; the first upload awaits usage. Check that the service is running
          without errors. The daemon will pick up usage on its next scheduled sync.
        </p>
        <p className="mt-3 text-[0.95rem] text-muted">
          Reconnecting a machine keeps its device. If you connected one machine more than once
          before, mark those devices as the same machine in{" "}
          <Link href="/settings" className="text-primary-text hover:underline">
            settings
          </Link>
          . Each day then counts once for that machine.
        </p>
      </ManualSetup>

      <div className="signal-rail my-10" aria-hidden />

      <section id="update" className="scroll-mt-20">
        <h2 className="type-heading">Already connected? Update and sync.</h2>
        <p className="mt-3 text-[0.95rem] text-muted">
          Run these on every computer you already connected. Installing the latest CLI also works
          with versions that do not have the update command. Send your whole history once after
          updating, then let the daemon keep it current.
        </p>
        <p className="mt-3 text-[0.95rem] text-muted">
          The install command below assumes npm. If you installed with another package manager,
          use that manager to install the latest CLI instead, or run{" "}
          <code className="type-data">tokenburnmarket update</code> if your version supports it.
          Check the version below to confirm the CLI on your PATH is current before syncing.
          Compare it with the published version reported by npm.
        </p>
        <div className="mt-4 grid max-w-[38rem] gap-2">
          <CommandLine command="npm install --global tokenburnmarket@latest" />
          <CommandLine command="tokenburnmarket --version" />
          <CommandLine command="npm view tokenburnmarket version" />
          <CommandLine command="tokenburnmarket sync --all" />
          <CommandLine command="tokenburnmarket daemon install" />
        </div>
        <p className="mt-4 text-[0.95rem] text-muted">
          Installing the latest CLI does not replace a daemon process that is already running.
          After installing the service above, follow the restart steps for your operating system
          so the daemon loads the updated collector.
        </p>
        <div className="mt-5 space-y-6">
          <div>
            <h3 className="type-label">macOS</h3>
            <p className="mt-3 text-[0.95rem] text-muted">
              The daemon install command above reloads the LaunchAgent, so it already restarts
              the daemon.
            </p>
          </div>
          <div>
            <h3 className="type-label">Linux (systemd)</h3>
            <p className="mt-3 text-[0.95rem] text-muted">
              Restart the user service. This also starts it if it is stopped.
            </p>
            <div className="mt-3 max-w-[38rem]">
              <CommandLine command="systemctl --user restart tokenburnmarket" />
            </div>
          </div>
          <div>
            <h3 className="type-label">Windows (Task Scheduler)</h3>
            <p className="mt-3 text-[0.95rem] text-muted">
              If the tokenburnmarket task is running, stop it first:
            </p>
            <div className="mt-3 max-w-[38rem]">
              <CommandLine command="schtasks /End /TN tokenburnmarket" />
            </div>
            <p className="mt-3 text-[0.95rem] text-muted">
              Wait until Task Scheduler no longer shows the task as Running, then start it below.
              If it was already stopped, run only the start command. Resolve any stop error
              before continuing.
            </p>
            <div className="mt-3 max-w-[38rem]">
              <CommandLine command="schtasks /Run /TN tokenburnmarket" />
            </div>
          </div>
        </div>
        <p className="mt-5 text-[0.95rem] text-muted">
          After the restart succeeds, check the connected account and last sync:
        </p>
        <div className="mt-3 max-w-[38rem]">
          <CommandLine command="tokenburnmarket status" />
        </div>
        <p className="mt-3 text-[0.95rem] text-muted">
          If sync says &quot;Not connected&quot;, complete{" "}
          <a href="#manual" className="text-primary-text hover:underline">the connection steps above</a>
          {" "}first, then retry. Restart agent sessions that use MCP after updating.
        </p>
        <h3 className="type-label mt-8">fix your history</h3>
        <p className="mt-3 text-[0.95rem] text-muted">
          If your numbers look low, repeat these steps on every computer you use.
        </p>
        <p className="mt-3 text-[0.95rem] text-muted">
          If you connected one machine more than once, open{" "}
          <Link href="/settings" className="text-primary-text hover:underline">
            settings
          </Link>{" "}
          and set its devices to the same machine.
        </p>
      </section>

      <div className="signal-rail my-10" aria-hidden />

      <h2 className="type-heading">Optional: add MCP to your agent</h2>
      <p className="mt-3 text-[0.95rem] text-muted">
        Add the MCP server to Claude Code or Codex for the tools below. While the agent session is
        running, MCP syncs on the same schedule as the daemon: {SYNC_SLOT_TIMES}.
        The daemon keeps syncing when your agent is closed.
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
        Run <span className="type-data">tokenburnmarket sync</span> or ask your agent to call{" "}
        <span className="type-data">sync_usage</span> to upload now, outside the automatic schedule.
        {" "}<span className="type-data">tokenburnmarket mcp setup</span> prints both configurations.
      </p>

      <h3 className="type-label mt-8">MCP tools</h3>
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
      <p className="mt-3 text-[0.95rem] text-muted">
        A new device can only quote. To let your agent place bets, tick the box when you approve
        the device, or allow bets for it in{" "}
        <Link href="/settings" className="text-primary-text hover:underline">
          settings
        </Link>
        .
      </p>

      <div className="signal-rail my-10" aria-hidden />

      <h2 className="type-heading">Sync and service reference</h2>
      <p className="mt-3 text-[0.95rem] text-muted">
        Setup is complete once this computer is connected and its background service is running.
        Use these commands when you need to inspect or sync usage manually. A sync uploads changed
        daily totals and receipt hashes.
      </p>
      <dl className="mt-4 grid max-w-[38rem] gap-5 text-[0.95rem] text-muted">
        <div>
          <dt><CommandLine command="tokenburnmarket sync" /></dt>
          <dd className="mt-2">The days since the last sync.</dd>
        </div>
        <div>
          <dt><CommandLine command="tokenburnmarket sync --since 7" /></dt>
          <dd className="mt-2">The last seven days.</dd>
        </div>
        <div>
          <dt><CommandLine command="tokenburnmarket sync --all" /></dt>
          <dd className="mt-2">
            Every day this machine still has. Missing days are added, and a day already counted
            goes up or is corrected. An older day never goes down because old transcripts were
            deleted.
          </dd>
        </div>
        <div>
          <dt><CommandLine command="tokenburnmarket sync --dry-run" /></dt>
          <dd className="mt-2">Prints what would go up and sends nothing.</dd>
        </div>
        <div>
          <dt><CommandLine command="tokenburnmarket sync --quiet" /></dt>
          <dd className="mt-2">Prints nothing unless something went wrong. For cron lines and scripts.</dd>
        </div>
        <div>
          <dt><CommandLine command="tokenburnmarket status" /></dt>
          <dd className="mt-2">Handle, device, server, and the last day synced from this machine.</dd>
        </div>
      </dl>

      <h3 className="type-label mt-8">background service</h3>
      <p className="mt-3 text-[0.95rem] text-muted">
        If you followed the setup above, the daemon is already installed. Its lock file allows
        one copy per computer.
      </p>
      <div className="mt-4 grid max-w-[30rem] gap-2">
        <CommandLine command="tokenburnmarket daemon install" />
        <CommandLine command="tokenburnmarket daemon install --dry-run" />
      </div>
      <p className="mt-4 text-[0.95rem] text-muted">
        <span className="type-data">daemon install</span> creates and starts the per-user
        LaunchAgent, systemd service, or Windows scheduled task. The dry run previews the service
        definition and changes nothing.
      </p>

      <div className="signal-rail my-10" aria-hidden />

      <h2 className="type-heading">Where things are stored</h2>
      <p className="mt-3 text-[0.95rem] text-muted">
        Config lives in the platform config directory:{" "}
        <span className="type-data">~/Library/Application Support/tokenburnmarket</span> on macOS,{" "}
        <span className="type-data">%APPDATA%\tokenburnmarket</span> on Windows,{" "}
        <span className="type-data">$XDG_CONFIG_HOME/tokenburnmarket</span> on Linux, falling back
        to <span className="type-data">~/.config/tokenburnmarket</span> when XDG_CONFIG_HOME is unset
        or relative. It holds a device token and a private key, and is written owner-only.
      </p>
      <p className="mt-3 text-[0.95rem] text-muted">
        <span className="type-data">TBM_SERVER</span> points the collector at another server, the
        same as <span className="type-data">--server</span>.{" "}
        <span className="type-data">TBM_CCUSAGE</span> names a local ccusage command to run instead
        of the tested ccusage version the collector fetches with npx.{" "}
        <span className="type-data">npx tokenburnmarket --help</span> lists every command.
      </p>
    </article>
  );
}
