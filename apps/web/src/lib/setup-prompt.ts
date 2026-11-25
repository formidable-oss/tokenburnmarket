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

1. Check \`node --version\`. Install Node 22.15 or newer if needed. Run \`npm install --global tokenburnmarket@latest\` with a user-owned npm prefix. Never use sudo. Verify PATH with \`command -v tokenburnmarket\` (macOS/Linux) or \`Get-Command tokenburnmarket\` (PowerShell). Fix the prefix until it resolves outside an npx cache.
2. Run \`tokenburnmarket connect --server ${PRODUCT_URL}\`. Show the approval URL, code, and fingerprint. Wait for browser approval and confirm the account in the terminal if asked. Connection uploads usage. If upload fails, retry with \`tokenburnmarket sync\`, not connect.
3. Run \`tokenburnmarket daemon install\`; it installs and starts the service itself. Automatic sync runs at ${SYNC_SLOT_TIMES} while this computer runs. Use the installed CLI path.
4. Run \`tokenburnmarket status\`. Finish only when the account is connected, the service is running, and its latest log has no errors. If there is no eligible history and sync reports "Nothing to sync.", "Synced to" and "Last sync" may remain "never"; report that the first upload awaits usage. Otherwise require both sync values. Fix any failed check.

Report handle, device, last sync, and service status. Omit secrets. MCP is optional. Offer it after setup; change agent config only if I ask.

Privacy boundary: upload token totals, cost, and hashed message IDs only. Keep prompts, paths, tokens, and private keys local.`;
}
