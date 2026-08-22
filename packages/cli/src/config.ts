/*
  Where the Collector keeps its identity.

  The config holds a private key, so it never goes near the current working
  directory: a repo checkout is the one place it must not end up. It lives in
  the platform's config directory, in a file only the owner can read.
*/
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** The npm package name, and the folder name under the platform config dir. */
export const APP_NAME = "tokenburnmarket";

/**
 * Where a Collector talks to unless told otherwise.
 *
 * The production deployment, addressed by its Vercel host: tokenburnmarket.com
 * is not registered yet, and a default that cannot resolve turns every command
 * into a DNS failure. Must stay equal to the web app's `NEXT_PUBLIC_APP_URL`,
 * since that is the host the approval link points at and polling a different
 * alias than the one the Builder opens is a coin flip nobody should take. Point
 * both at the apex domain once it exists, and note that this ships baked into
 * the published `dist`, so changing it needs a release.
 */
export const DEFAULT_SERVER_URL = "https://tokenburnmarket.vercel.app";

export interface PlatformEnvironment {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
}

/**
 * The platform's per-user config directory for this app.
 *
 * macOS: ~/Library/Application Support/tokenburnmarket
 * Windows: %APPDATA%\tokenburnmarket
 * elsewhere: $XDG_CONFIG_HOME/tokenburnmarket, or ~/.config/tokenburnmarket
 *
 * Taken as an argument rather than read from `process` so the resolution can be
 * tested for every platform from one machine.
 */
export function configDirFor({ platform, env, home }: PlatformEnvironment): string {
  if (platform === "darwin") return join(home, "Library", "Application Support", APP_NAME);
  if (platform === "win32") {
    const appData = env.APPDATA?.trim();
    return join(appData && appData.length > 0 ? appData : join(home, "AppData", "Roaming"), APP_NAME);
  }
  const xdg = env.XDG_CONFIG_HOME?.trim();
  // A relative XDG_CONFIG_HOME is invalid per the spec, so fall back rather than resolve it.
  const base = xdg && xdg.startsWith("/") ? xdg : join(home, ".config");
  return join(base, APP_NAME);
}

export function currentConfigDir(): string {
  return configDirFor({ platform: process.platform, env: process.env, home: homedir() });
}

export function configPathFor(environment: PlatformEnvironment): string {
  return join(configDirFor(environment), "config.json");
}

export function currentConfigPath(): string {
  return join(currentConfigDir(), "config.json");
}

/*
  What one connected Device knows about itself. `privateKey` is a base64 PKCS#8
  Ed25519 key, `publicKey` a base64 raw key: the encoding `@tokenburnmarket/core`
  signs and verifies with, so the file needs no conversion step.
*/
export interface DeviceConfig {
  serverUrl: string;
  deviceId: string;
  deviceName: string;
  handle: string;
  deviceToken: string;
  publicKey: string;
  privateKey: string;
  connectedAt: string;
  /*
    The Sync watermark the server last returned. Held here so a Sync knows which
    days to collect without a round trip; the server is still the authority, and
    a missing or stale value only costs a wider window.
  */
  lastSyncedDay?: string | null;
  /**
   * When the last upload succeeded. What an automatic sync checks before
   * spending six seconds re-reading transcripts that cannot have changed much.
   */
  lastSyncedAt?: string;
}

/** Read the stored Device, or null when this machine has never connected. */
export function readConfig(path = currentConfigPath()): DeviceConfig | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<DeviceConfig>;
    if (!parsed.deviceId || !parsed.deviceToken || !parsed.privateKey) return null;
    return parsed as DeviceConfig;
  } catch {
    // A truncated or hand-edited file is treated as "not connected", never as a crash.
    return null;
  }
}

/** Write the Device, owner-readable only. Replaces whatever was there. */
export function writeConfig(config: DeviceConfig, path = currentConfigPath()): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

/** The server this invocation should talk to: flag, then env, then the default. */
export function resolveServerUrl(flag: string | undefined, env: NodeJS.ProcessEnv): string {
  const chosen = flag?.trim() || env.TBM_SERVER?.trim() || DEFAULT_SERVER_URL;
  return chosen.replace(/\/+$/, "");
}
