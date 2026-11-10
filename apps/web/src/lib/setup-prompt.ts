import { SYNC_SLOT_TIMES } from "@tokenburnmarket/core";

const PRODUCT_URL = "https://tokenburnmarket.vercel.app";

/**
 * The setup handoff shown to a new Builder. It gives the coding agent an
 * outcome to reach and checks to run, while leaving OS-specific service work to
 * the agent that can inspect the machine it is changing.
 */
export function agentSetupPrompt(handle?: string): string {
  const account = handle ? ` for @${handle}` : "";

  return `Set up tokenburnmarket on this machine${account}. Complete every check.

1. Check \`node --version\`. Install Node 22.15 or newer if needed. Run \`npm install --global tokenburnmarket@latest\` with a user-owned npm prefix. Never use sudo. Run \`command -v tokenburnmarket\` and fix the prefix until it resolves outside an npx cache.
2. Run \`tokenburnmarket connect --server ${PRODUCT_URL}\`. Show the approval URL, code, and fingerprint. Wait for browser approval and confirm the account in the terminal if asked. Connection uploads usage. If upload fails, retry with \`tokenburnmarket sync\`, not connect.
3. Run \`tokenburnmarket daemon install\`; it installs and starts the service itself. Automatic sync runs at ${SYNC_SLOT_TIMES} while this computer runs. Use the installed CLI path.
4. Run \`tokenburnmarket mcp setup\`. If this agent supports MCP, merge the server into its user config. Preserve settings and report any required restart.
5. Run \`tokenburnmarket status\`. Finish only when "Synced to" and "Last sync" have values, the service is running, and its latest log has no errors. Call \`my_stats\` through MCP if available. Fix any failed check.

Report handle, device, last sync, service status, and MCP status. Omit secrets.

Privacy boundary: upload token totals, cost, and hashed message IDs only. Keep prompts, paths, tokens, and private keys local.`;
}
