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
import { describeError } from "./errors.js";
import { mcpSetupLines } from "./setup.js";
import { sync } from "./sync.js";

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

async function postJson<T>(fetchImpl: typeof fetch, url: string, body: unknown): Promise<T> {
  const response = await fetchImpl(url, {
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
  fetch?: typeof fetch;
  pollIntervalMs?: number;
  /** Injected in tests. The first sync, run the moment the device is approved. */
  runSync?: (config: DeviceConfig, log: (line: string) => void) => Promise<number>;
  /**
   * Asks a person yes or no. Given when someone is at the terminal; an agent
   * running `connect` gets no question.
   */
  confirm?: (question: string) => Promise<boolean>;
}

export async function connect(options: ConnectOptions): Promise<DeviceConfig> {
  const log = options.log ?? ((line: string) => console.log(line));
  const now = options.now ?? Date.now;
  const configPath = options.configPath ?? currentConfigPath();
  const deviceName = options.deviceName?.trim() || defaultDeviceName();
  const fetchImpl = options.fetch ?? fetch;
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const runSync =
    options.runSync ??
    ((_config: DeviceConfig, syncLog: (line: string) => void) =>
      sync({ configPath, brief: true, log: syncLog }));

  /*
    Reconnecting keeps this machine's key, so the server keeps the same Device
    and the machine's history counts once. A new key would be a new Device that
    uploads the same history again (ADR 0006).
  */
  const existing = readConfig(configPath);
  const sameServer = existing !== null && existing.serverUrl === options.serverUrl;
  if (existing) {
    log(`This machine is already connected as @${existing.handle}.`);
    log(
      sameServer
        ? "Approve the code to reconnect the same device."
        : "Connecting to another server replaces the stored device.",
    );
    log("");
  }

  const keys =
    existing && sameServer
      ? { publicKey: existing.publicKey, privateKey: existing.privateKey }
      : await generateDeviceKeyPair();
  const started = await postJson<StartResponse>(fetchImpl, `${options.serverUrl}/api/connect/start`, {
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
    await sleep(pollIntervalMs);
    const response = await fetchImpl(pollUrl, { headers: { accept: "application/json" } });
    if (!response.ok) continue; // A blip on one poll is not a failed connect.

    const result = (await response.json()) as PollResponse;
    if (result.status === "pending") continue;
    if (result.status === "expired") {
      throw new Error("That code was rejected or ran out. Run connect again for a fresh one.");
    }

    // Anyone signed in can approve a code they can see, so say whose account
    // this is before anything is saved, and ask when a person is there.
    if (existing && existing.handle !== result.handle) {
      log(`This machine was connected as @${existing.handle}. The code was approved by @${result.handle}.`);
    }
    if (options.confirm && !(await options.confirm(`Connect this machine to @${result.handle}? [y/N] `))) {
      // The server already gave the stored key to that account, so connecting
      // again with it would be refused. A fresh key needs the old config gone.
      const retry = existing && sameServer ? ` To connect again, delete ${configPath} first.` : "";
      throw new Error(
        `Not connected, and nothing was saved. If @${result.handle} is not you, someone else approved the code.${retry}`,
      );
    }

    // The same Device keeps its watermark, so the first sync covers only
    // the days since the last one instead of the whole history again.
    const sameDevice = existing !== null && sameServer && existing.deviceId === result.deviceId;
    const config: DeviceConfig = {
      serverUrl: options.serverUrl,
      deviceId: result.deviceId,
      deviceName,
      handle: result.handle,
      deviceToken: result.deviceToken,
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      connectedAt: new Date(now()).toISOString(),
      ...(sameDevice ? { lastSyncedDay: existing.lastSyncedDay, lastSyncedAt: existing.lastSyncedAt } : {}),
    };
    writeConfig(config, configPath);

    log("");
    log(`connected as @${result.handle}`);
    log("");

    /*
      The first sync, right here, because a connected machine with nothing
      uploaded is not on any board yet, and the person came to see themselves
      on one. The sync prints its own progress. If it fails the device is still
      connected: say what broke and how to retry, then carry on to the setup
      lines. The profile is fresh the moment the sync lands; boards are cached
      for five minutes, and promising a rank before it shows would read as a lie.
    */
    try {
      await runSync(config, log);
    } catch (error) {
      log(`The first sync failed: ${describeError(error)}`);
      log("The device is connected. Run it again with: tokenburnmarket sync");
    }
    log("");
    log(`Your profile: ${options.serverUrl}/@${result.handle}`);
    log("Boards catch up within five minutes.");
    log("");
    for (const line of mcpSetupLines()) log(line);
    return config;
  }

  throw new Error("The code ran out before it was approved. Run connect again.");
}
