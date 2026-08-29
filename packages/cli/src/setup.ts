/*
  The lines someone reads after `connect`, and again from `mcp setup` once the
  terminal has scrolled away.

  The MCP server syncs itself every time an agent starts it, so for anyone who
  uses Claude Code or Codex, adding it is the whole of "keep it synced". The
  daemon is for the machine that never opens an agent.
*/

/** Ready to paste: Claude Code, then the Codex config file, then the no-agent fallback. */
export function mcpSetupLines(): string[] {
  return [
    "The first upload is complete. Automatic sync is not active until you add MCP or the daemon:",
    "",
    "Keep it synced. Add the MCP server and it syncs itself every session:",
    "  claude mcp add tokenburnmarket -- npx -y tokenburnmarket mcp",
    "",
    "Codex, in ~/.codex/config.toml:",
    "  [mcp_servers.tokenburnmarket]",
    '  command = "npx"',
    '  args = ["-y", "tokenburnmarket", "mcp"]',
    "",
    "No agent? Sync on a timer instead:",
    "  tokenburnmarket daemon install",
  ];
}
