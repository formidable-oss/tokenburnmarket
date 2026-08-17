/*
  The lines someone pastes to point their agent at this machine.

  Printed at the end of `connect`, because that is the moment they are useful,
  and by `mcp --setup` for when the terminal has scrolled away.
*/

/** Ready to paste: Claude Code, then the Codex config file. */
export function mcpSetupLines(): string[] {
  return [
    "Point Claude Code at it:",
    "  claude mcp add tokenburnmarket -- npx -y tokenburnmarket mcp",
    "",
    "Or Codex, in ~/.codex/config.toml:",
    "  [mcp_servers.tokenburnmarket]",
    '  command = "npx"',
    '  args = ["-y", "tokenburnmarket", "mcp"]',
    "",
    "Sync when a Claude Code session finishes:",
    "  tokenburnmarket hook install",
  ];
}
