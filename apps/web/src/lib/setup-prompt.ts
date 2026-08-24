const PRODUCT_URL = "https://tokenburnmarket.vercel.app";

/**
 * The setup handoff shown to a new Builder. It gives the coding agent an
 * outcome to reach and checks to run, while leaving OS-specific service work to
 * the agent that can inspect the machine it is changing.
 */
export function agentSetupPrompt(handle?: string): string {
  const account = handle ? ` for @${handle}` : "";

  return `Set up tokenburnmarket on this machine${account}. Work until every check below passes.

1. Check \`node --version\`. Install Node 20 or newer if needed, then run \`npm install --global tokenburnmarket@latest\` with a user-owned npm prefix. Never use sudo.
2. Run \`tokenburnmarket connect --server ${PRODUCT_URL}\`. Show me the approval URL, code, and fingerprint, then wait for approval. Keep the device token and private key on this machine.
3. Run \`tokenburnmarket sync\`. Then run \`tokenburnmarket daemon install --interval 15m\` and follow its output to install and start the per-user service. Use the installed CLI path, not an npx cache path. On Windows, create the matching per-user Task Scheduler job.
4. Run \`tokenburnmarket mcp setup\`. If this agent supports MCP, merge the server into its user config. Keep existing settings and tell me if a restart is needed.
5. Run \`tokenburnmarket status\`. Finish only when "Synced to" and "Last sync" have values, the service is running, and its latest log has no errors. Call \`my_stats\` through MCP if available. Fix any failed check.

Report the handle, device, last sync, service status, and MCP status. Omit secrets.

Privacy boundary: upload token totals, cost, and hashed message IDs only. Keep prompts, paths, tokens, and private keys local.`;
}
