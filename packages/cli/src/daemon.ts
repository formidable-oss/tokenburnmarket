/*
  `tokenburnmarket daemon`: sync on the Sync Slots, in the foreground.

  Slots rather than a timer of its own (ADR 0005): every Collector syncs in the
  same few windows a day, so the database wakes for all of them at once. Units
  installed by older versions pass `--interval`; it is accepted and ignored.

  Foreground on purpose. A background daemon that forks itself has to own its
  own logs, its own restarts and its own uninstall story; a foreground loop that
  a service manager supervises has none of those problems, and `daemon install`
  installs and starts the unit that does the supervising.

  One machine runs one daemon. The lock file is how that is enforced, and it is
  a plain file rather than a socket so a crash leaves something readable behind.
*/
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { currentConfigDir } from "./config.js";
import { SYNC_SLOT_TIMES } from "@tokenburnmarket/core";
import { msUntilScheduledSync, sync } from "./sync.js";

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
  configDir?: string;
  log?: (line: string) => void;
  /** Injected in tests: how many passes to run before returning. Undefined means forever. */
  maxRuns?: number;
  runSync?: () => Promise<number>;
  wait?: (ms: number) => Promise<void>;
  /** Injected in tests: how long until the next slot. */
  untilNextSlot?: () => number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The loop. A failed pass is reported and the daemon keeps its schedule: a
 * laptop that woke up without wifi should sync at the next tick, not exit.
 */
export async function daemon(options: DaemonOptions = {}): Promise<number> {
  const log = options.log ?? ((line: string) => console.log(line));
  const lock = acquireLock(lockPathFor(options.configDir ?? currentConfigDir()));
  if (!lock.ok) {
    log(`A daemon is already running on this machine, as process ${lock.heldBy}.`);
    return 1;
  }

  const runSync = options.runSync ?? (() => sync({ log, scheduled: true }));
  const untilNextSlot = options.untilNextSlot ?? (() => msUntilScheduledSync(new Date()));
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

  log(`Syncing at ${SYNC_SLOT_TIMES}. Stop with ctrl-c.`);

  try {
    for (let run = 0; options.maxRuns === undefined || run < options.maxRuns; run += 1) {
      const at = new Date().toISOString().replace("T", " ").slice(0, 19);
      log(`[${at}] sync`);
      try {
        await runSync();
      } catch (error) {
        log(`[${at}] sync failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      await wait(untilNextSlot());
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
  home: string;
}

interface CommandResult {
  status: number | null;
  stderr: string;
}

export interface InstallDaemonOptions {
  log?: (line: string) => void;
  run?: (command: string, args: readonly string[]) => CommandResult;
}

function servicePath(context: InstallContext): string {
  return [
    dirname(context.execPath),
    join(context.home, ".local/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ]
    .filter((path, index, all) => all.indexOf(path) === index)
    .join(":");
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
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${servicePath(context)}</string>
  </dict>
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
Environment="PATH=${servicePath(context)}"
ExecStart=${context.execPath} ${context.scriptPath} daemon
Restart=always
RestartSec=30

[Install]
WantedBy=default.target`;
}

function runCommand(command: string, args: readonly string[]): CommandResult {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return {
    status: result.status,
    stderr: result.stderr?.trim() || result.error?.message || "",
  };
}

function commandFailed(
  result: CommandResult,
  action: string,
  log: (line: string) => void,
): boolean {
  if (result.status === 0) return false;
  log(`${action} failed${result.stderr ? `: ${result.stderr}` : "."}`);
  return true;
}

/** Install and start the current CLI as a per-user background service. */
export function installDaemon(
  context: InstallContext,
  options: InstallDaemonOptions = {},
): number {
  const log = options.log ?? ((line: string) => console.log(line));
  const run = options.run ?? runCommand;
  if (/[\\/]_npx[\\/]/.test(context.scriptPath)) {
    log("Refusing to install a service from a temporary npx cache.");
    log("Install the CLI first: npm install --global tokenburnmarket@latest");
    return 1;
  }

  if (context.platform === "darwin") {
    const path = join(context.home, "Library/LaunchAgents/com.tokenburnmarket.daemon.plist");
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    if (existsSync(path)) run("launchctl", ["unload", "-w", path]);
    writeFileSync(path, `${launchdPlist(context)}\n`, { mode: 0o600 });
    if (commandFailed(run("launchctl", ["load", "-w", path]), "Starting the LaunchAgent", log)) {
      return 1;
    }
    log(`Installed and started ${path}`);
    log(
      `Usage will sync at ${SYNC_SLOT_TIMES}. Logs: ${context.home}/Library/Logs/tokenburnmarket.log`,
    );
    return 0;
  }

  if (context.platform === "win32") {
    const taskCommand = `"${context.execPath}" "${context.scriptPath}" daemon`;
    if (
      commandFailed(
        run("schtasks", [
          "/Create",
          "/F",
          "/SC",
          "ONLOGON",
          "/RL",
          "LIMITED",
          "/TN",
          "tokenburnmarket",
          "/TR",
          taskCommand,
        ]),
        "Installing the scheduled task",
        log,
      )
    ) {
      return 1;
    }
    if (
      commandFailed(
        run("schtasks", ["/Run", "/TN", "tokenburnmarket"]),
        "Starting the scheduled task",
        log,
      )
    ) {
      return 1;
    }
    log("Installed and started the tokenburnmarket scheduled task.");
    log(`Usage will sync at ${SYNC_SLOT_TIMES}.`);
    return 0;
  }

  const path = join(context.home, ".config/systemd/user/tokenburnmarket.service");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${systemdUnit(context)}\n`, { mode: 0o600 });
  if (commandFailed(run("systemctl", ["--user", "daemon-reload"]), "Reloading systemd", log)) {
    return 1;
  }
  if (
    commandFailed(
      run("systemctl", ["--user", "enable", "--now", "tokenburnmarket"]),
      "Starting the systemd service",
      log,
    )
  ) {
    return 1;
  }
  log(`Installed and started ${path}`);
  log(`Usage will sync at ${SYNC_SLOT_TIMES}.`);
  return 0;
}

/**
 * Preview what `daemon install` will write and run without changing the machine.
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
      `  ${context.execPath} ${context.scriptPath} daemon`,
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
