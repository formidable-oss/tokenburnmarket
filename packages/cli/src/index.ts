#!/usr/bin/env node
/*
  tokenburnmarket, the Collector.

  Implemented: connect (bind this machine to a Builder) and status (what is
  stored here). sync, daemon and mcp arrive with their own tickets.
*/
import { parseArgs } from "./args.js";
import { connect } from "./connect.js";
import { currentConfigPath, readConfig, resolveServerUrl } from "./config.js";

const USAGE = `tokenburnmarket

  connect [--server URL] [--name NAME]   bind this machine to your account
  status                                 show what is stored on this machine

  --server URL   the server to talk to, also settable as TBM_SERVER
  --name NAME    what this device is called, defaults to the hostname
`;

/** What `status` prints. Never the token, never the private key. */
function status(): void {
  const path = currentConfigPath();
  const config = readConfig(path);
  if (!config) {
    console.log("Not connected. Run: tokenburnmarket connect");
    console.log(`Nothing stored at ${path}`);
    return;
  }
  console.log(`Handle      @${config.handle}`);
  console.log(`Device      ${config.deviceName}`);
  console.log(`Device id   ${config.deviceId}`);
  console.log(`Server      ${config.serverUrl}`);
  console.log(`Connected   ${config.connectedAt}`);
  console.log(`Config      ${path}`);
}

async function main(): Promise<number> {
  const { command, flags, switches } = parseArgs(process.argv.slice(2));

  if (!command || command === "help" || switches.has("help") || switches.has("h")) {
    console.log(USAGE);
    return 0;
  }

  switch (command) {
    case "connect":
      await connect({
        serverUrl: resolveServerUrl(flags.server, process.env),
        deviceName: flags.name,
      });
      return 0;
    case "status":
      status();
      return 0;
    default:
      console.error(`Unknown command: ${command}`);
      console.error(USAGE);
      return 1;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
