/*
  `tokenburnmarket daemon`: sync on a timer, in the foreground.

  Foreground on purpose. A background daemon that forks itself has to own its
  own logs, its own restarts and its own uninstall story; a foreground loop that
  a service manager supervises has none of those problems, and `daemon install`
  prints the unit that does the supervising.

  One machine runs one daemon. The lock file is how that is enforced, and it is
  a plain file rather than a socket so a crash leaves something readable behind.
*/
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { currentConfigDir } from "./config.js";
import { sync } from "./sync.js";

/** How often a daemon syncs when nothing says otherwise. */
export const DEFAULT_INTERVAL = "15m";

/** Below this the daemon would spend more time syncing than working. */
export const MIN_INTERVAL_MS = 60_000;
const MAX_INTERVAL_MS = 24 * 3_600_000;

const UNITS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000 };

export type ParsedInterval = { ok: true; ms: number } | { ok: false; error: string };

/**
 * `--interval` as milliseconds. Takes `30s`, `15m`, `2h`, and a bare number as
 * minutes, because that is what people type when they forget the suffix.
 */
export function parseInterval(input: string | undefined): ParsedInterval {
  const raw = (input ?? DEFAULT_INTERVAL).trim().toLowerCase();
  const match = /^(\d+(?:\.\d+)?)(s|m|h)?$/.exec(raw);
  if (!match) return { ok: false, error: "Interval looks like 30s, 15m or 2h." };

  const ms = Number(match[1]) * UNITS[match[2] ?? "m"]!;
  if (!Number.isFinite(ms) || ms < MIN_INTERVAL_MS) {
    return { ok: false, error: "Sync at most once a minute." };
  }
  if (ms > MAX_INTERVAL_MS) return { ok: false, error: "Sync at least once a day." };
  return { ok: true, ms };
}

export function lockPathFor(configDir: string): string {
  return join(configDir, "daemon.lock");
}

interface LockFile {
  pid: number;
  startedAt: string;
}

export type LockResult =
  | { ok: true; release: () => void }
  | { ok: false; heldBy: number };

/**
 * Take the daemon lock, or report who holds it.
 *
 * A lock whose process is gone is stale and gets taken over: a machine that was
 * shut down mid-sync should not need a manual cleanup before it syncs again.
 * `alive` is injected so that path is testable without spawning anything.
 */
export function acquireLock(
  path: string,
  pid = process.pid,
  alive: (pid: number) => boolean = isAlive,
): LockResult {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });

  if (existsSync(path)) {
    let held: LockFile | null = null;
    try {
      held = JSON.parse(readFileSync(path, "utf8")) as LockFile;
    } catch {
      held = null; // An unreadable lock is a stale lock, not a reason to stop.
    }
    if (held && held.pid !== pid && alive(held.pid)) return { ok: false, heldBy: held.pid };
  }

  const contents: LockFile = { pid, startedAt: new Date().toISOString() };
  writeFileSync(path, `${JSON.stringify(contents)}\n`, { mode: 0o600 });

  return {
    ok: true,
    release: () => {
      // Only ever remove our own lock: a takeover elsewhere must survive our exit.
      try {
        const current = JSON.parse(readFileSync(path, "utf8")) as LockFile;
        if (current.pid === pid) rmSync(path, { force: true });
      } catch {
        // Already gone, which is the state we wanted.
      }
    },
  };
}

function isAlive(pid: number): boolean {
  try {
    // Signal 0 checks for the process without touching it.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists and belongs to someone else, which still counts.
    return (error as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

export interface DaemonOptions {
  interval?: string;
  configDir?: string;
  log?: (line: string) => void;
  /** Injected in tests: how many passes to run before returning. Undefined means forever. */
  maxRuns?: number;
  runSync?: () => Promise<number>;
  wait?: (ms: number) => Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The loop. A failed pass is reported and the daemon keeps its schedule: a
 * laptop that woke up without wifi should sync at the next tick, not exit.
 */
export async function daemon(options: DaemonOptions = {}): Promise<number> {
  const log = options.log ?? ((line: string) => console.log(line));
  const interval = parseInterval(options.interval);
  if (!interval.ok) {
    log(interval.error);
    return 1;
  }

  const lock = acquireLock(lockPathFor(options.configDir ?? currentConfigDir()));
  if (!lock.ok) {
    log(`A daemon is already running on this machine, as process ${lock.heldBy}.`);
    return 1;
  }

  const runSync = options.runSync ?? (() => sync({ log }));
  const wait = options.wait ?? sleep;
  const stop = () => {
    lock.release();
    process.exit(0);
  };
  const supervised = options.maxRuns === undefined;
  if (supervised) {
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  }

  log(`Syncing every ${options.interval ?? DEFAULT_INTERVAL}. Stop with ctrl-c.`);

  try {
    for (let run = 0; options.maxRuns === undefined || run < options.maxRuns; run += 1) {
      const at = new Date().toISOString().replace("T", " ").slice(0, 19);
      log(`[${at}] sync`);
      try {
        await runSync();
      } catch (error) {
        log(`[${at}] sync failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      await wait(interval.ms);
    }
  } finally {
    lock.release();
  }
  return 0;
}

export interface InstallContext {
  platform: NodeJS.Platform;
  /** The node binary running this process, so the unit points at the same one. */
  execPath: string;
  /** The resolved path of the CLI entry point. */
  scriptPath: string;
  interval: string;
  home: string;
}

/** The launchd job macOS wants, keyed by the reverse-DNS label launchd expects. */
function launchdPlist(context: InstallContext): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.tokenburnmarket.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${context.execPath}</string>
    <string>${context.scriptPath}</string>
    <string>daemon</string>
    <string>--interval</string>
    <string>${context.interval}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${context.home}/Library/Logs/tokenburnmarket.log</string>
  <key>StandardErrorPath</key><string>${context.home}/Library/Logs/tokenburnmarket.log</string>
</dict>
</plist>`;
}

function systemdUnit(context: InstallContext): string {
  return `[Unit]
Description=tokenburnmarket usage sync
After=network-online.target

[Service]
Type=simple
ExecStart=${context.execPath} ${context.scriptPath} daemon --interval ${context.interval}
Restart=always
RestartSec=30

[Install]
WantedBy=default.target`;
}

/**
 * What `daemon install` prints. It prints; it never writes. A service that
 * starts on login is the sort of thing someone should read before it exists,
 * and the two commands underneath are the whole install.
 */
export function installSnippet(context: InstallContext): string[] {
  if (context.platform === "darwin") {
    const path = `${context.home}/Library/LaunchAgents/com.tokenburnmarket.daemon.plist`;
    return [
      `Save this as ${path}`,
      "",
      launchdPlist(context),
      "",
      "Then load it:",
      `  launchctl load -w ${path}`,
      "",
      "To stop it later:",
      `  launchctl unload -w ${path}`,
    ];
  }

  if (context.platform === "win32") {
    return [
      "Windows has no unit file to print. Use Task Scheduler with:",
      "",
      `  ${context.execPath} ${context.scriptPath} daemon --interval ${context.interval}`,
      "",
      "Set it to run at logon and restart on failure.",
    ];
  }

  const path = `${context.home}/.config/systemd/user/tokenburnmarket.service`;
  return [
    `Save this as ${path}`,
    "",
    systemdUnit(context),
    "",
    "Then enable it:",
    "  systemctl --user daemon-reload",
    "  systemctl --user enable --now tokenburnmarket",
    "",
    "To stop it later:",
    "  systemctl --user disable --now tokenburnmarket",
  ];
}
