/*
  `tokenburnmarket connect`: generate a keypair, ask for a short code, wait for
  the Builder to approve it in a browser, store the Device.

  The private key never leaves this machine. What travels is the public key, and
  what comes back is a token bound to the Device row the approval created.
*/
import { createHash } from "node:crypto";
import { hostname } from "node:os";
// The signing subpath, not the barrel: the CLI bundles what it imports, and the
// barrel would drag zod and every market formula into a connect command.
import { generateDeviceKeyPair } from "@tokenburnmarket/core/signing";
import {
  readConfig,
  writeConfig,
  currentConfigPath,
  type DeviceConfig,
} from "./config.js";
import { mcpSetupLines } from "./setup.js";

/** How often the CLI asks whether the code was approved. */
const POLL_INTERVAL_MS = 2000;

interface StartResponse {
  code: string;
  url: string;
  expiresAt: string;
}

type PollResponse =
  | { status: "pending" }
  | { status: "expired" }
  | { status: "approved"; deviceId: string; deviceToken: string; handle: string };

/**
 * The key as a human comparison string. Must stay identical to
 * `formatFingerprint` in apps/web/src/lib/connect-codes.ts: the whole point is
 * that the terminal and the browser show the same characters.
 */
export function fingerprint(publicKeyBase64: string): string {
  const digest = createHash("sha256").update(publicKeyBase64).digest("hex");
  return (digest.slice(0, 16).toUpperCase().match(/.{4}/g) ?? []).join(" ");
}

/** The machine's name, as the Builder will see it in the approval page and in settings. */
export function defaultDeviceName(): string {
  const name = hostname().replace(/\.local$/, "").trim();
  return name.length > 0 ? name.slice(0, 64) : "unnamed device";
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${url} answered ${response.status}. ${detail.slice(0, 200)}`.trim());
  }
  return (await response.json()) as T;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface ConnectOptions {
  serverUrl: string;
  deviceName?: string;
  configPath?: string;
  /** Injected in tests; the command prints as it goes rather than at the end. */
  log?: (line: string) => void;
  now?: () => number;
}

export async function connect(options: ConnectOptions): Promise<DeviceConfig> {
  const log = options.log ?? ((line: string) => console.log(line));
  const now = options.now ?? Date.now;
  const configPath = options.configPath ?? currentConfigPath();
  const deviceName = options.deviceName?.trim() || defaultDeviceName();

  const existing = readConfig(configPath);
  if (existing) {
    log(`This machine is already connected as @${existing.handle}.`);
    log("Connecting again replaces the stored device. Revoke the old one in settings.");
    log("");
  }

  const keys = await generateDeviceKeyPair();
  const started = await postJson<StartResponse>(`${options.serverUrl}/api/connect/start`, {
    publicKey: keys.publicKey,
    deviceName,
  });

  log(`Device      ${deviceName}`);
  log(`Fingerprint ${fingerprint(keys.publicKey)}`);
  log(`Code        ${started.code}`);
  log("");
  log("Approve it here:");
  log(`  ${started.url}`);
  log("");
  log("Waiting for approval. The code lasts ten minutes.");

  const deadline = Date.parse(started.expiresAt);
  const pollUrl = `${options.serverUrl}/api/connect/${started.code}`;

  while (now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const response = await fetch(pollUrl, { headers: { accept: "application/json" } });
    if (!response.ok) continue; // A blip on one poll is not a failed connect.

    const result = (await response.json()) as PollResponse;
    if (result.status === "pending") continue;
    if (result.status === "expired") {
      throw new Error("That code was rejected or ran out. Run connect again for a fresh one.");
    }

    const config: DeviceConfig = {
      serverUrl: options.serverUrl,
      deviceId: result.deviceId,
      deviceName,
      handle: result.handle,
      deviceToken: result.deviceToken,
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      connectedAt: new Date(now()).toISOString(),
    };
    writeConfig(config, configPath);

    log("");
    log(`connected as @${result.handle}`);
    log(`Device saved to ${configPath}`);
    log("");
    for (const line of mcpSetupLines()) log(line);
    return config;
  }

  throw new Error("The code ran out before it was approved. Run connect again.");
}
