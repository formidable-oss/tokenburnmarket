/*
  The lines someone reads after `connect`, and the agent configuration that
  `mcp setup` prints again once the terminal has scrolled away.

  The daemon is what keeps a machine synced: it runs on the sync slots whether
  or not an agent is open. The MCP server is optional. It gives an agent the
  trading tools, and syncs on the same slots only while that agent runs.
*/
import { SYNC_SLOT_TIMES } from "@tokenburnmarket/core";

/** What to do after connecting: install the daemon, then optionally add MCP. */
export function afterConnectLines(): string[] {
  return [
    `Keep it synced. Install the background service; it syncs at ${SYNC_SLOT_TIMES} while this computer runs:`,
    "  tokenburnmarket daemon install",
    "",
    "Optional: add the MCP server to give your agent the trading tools.",
    ...mcpSetupLines(),
  ];
}

/** Ready to paste: Claude Code, then the Codex config file. */
export function mcpSetupLines(): string[] {
  return [
    "Claude Code:",
    "  claude mcp add tokenburnmarket -- npx -y tokenburnmarket mcp",
    "",
    "Codex, in ~/.codex/config.toml:",
    "  [mcp_servers.tokenburnmarket]",
    '  command = "npx"',
    '  args = ["-y", "tokenburnmarket", "mcp"]',
  ];
}
