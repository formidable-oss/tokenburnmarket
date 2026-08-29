import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_INTERVAL,
  MIN_INTERVAL_MS,
  acquireLock,
  daemon,
  installDaemon,
  installSnippet,
  lockPathFor,
  parseInterval,
} from "./daemon";

const temporary: string[] = [];

function workDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "tbm-daemon-"));
  temporary.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("parseInterval", () => {
  it("takes seconds, minutes and hours", () => {
    expect(parseInterval("90s")).toEqual({ ok: true, ms: 90_000 });
    expect(parseInterval("15m")).toEqual({ ok: true, ms: 900_000 });
    expect(parseInterval("2h")).toEqual({ ok: true, ms: 7_200_000 });
  });

  it("reads a bare number as minutes", () => {
    expect(parseInterval("5")).toEqual({ ok: true, ms: 300_000 });
  });

  it("defaults to fifteen minutes", () => {
    expect(parseInterval(undefined)).toEqual(parseInterval(DEFAULT_INTERVAL));
    expect(parseInterval(undefined)).toEqual({ ok: true, ms: 900_000 });
  });

  it("refuses anything faster than once a minute", () => {
    expect(parseInterval("30s").ok).toBe(false);
    expect(parseInterval(`${MIN_INTERVAL_MS / 1000}s`).ok).toBe(true);
  });

  it("refuses nonsense and anything slower than a day", () => {
    expect(parseInterval("soon").ok).toBe(false);
    expect(parseInterval("-5m").ok).toBe(false);
    expect(parseInterval("48h").ok).toBe(false);
  });
});

describe("acquireLock", () => {
  it("writes the lock and removes it on release", () => {
    const path = lockPathFor(workDir());
    const lock = acquireLock(path, 4242, () => true);
    expect(lock.ok).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8")).pid).toBe(4242);

    if (lock.ok) lock.release();
    expect(existsSync(path)).toBe(false);
  });

  it("refuses a second daemon while the first is alive", () => {
    const path = lockPathFor(workDir());
    acquireLock(path, 4242, () => true);
    expect(acquireLock(path, 5555, () => true)).toEqual({ ok: false, heldBy: 4242 });
  });

  it("takes over a lock whose process is gone", () => {
    const path = lockPathFor(workDir());
    acquireLock(path, 4242, () => true);
    const second = acquireLock(path, 5555, () => false);
    expect(second.ok).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8")).pid).toBe(5555);
  });

  it("treats an unreadable lock as stale", () => {
    const path = lockPathFor(workDir());
    writeFileSync(path, "not json");
    expect(acquireLock(path, 5555, () => true).ok).toBe(true);
  });

  it("does not remove a lock that was taken over by someone else", () => {
    const path = lockPathFor(workDir());
    const first = acquireLock(path, 4242, () => true);
    acquireLock(path, 5555, () => false);
    if (first.ok) first.release();
    expect(JSON.parse(readFileSync(path, "utf8")).pid).toBe(5555);
  });
});

describe("daemon", () => {
  it("syncs once per interval and releases the lock at the end", async () => {
    const dir = workDir();
    const waits: number[] = [];
    let runs = 0;

    const code = await daemon({
      interval: "1m",
      configDir: dir,
      log: () => {},
      maxRuns: 3,
      runSync: async () => {
        runs += 1;
        return 0;
      },
      wait: async (ms) => {
        waits.push(ms);
      },
    });

    expect(code).toBe(0);
    expect(runs).toBe(3);
    expect(waits).toEqual([60_000, 60_000, 60_000]);
    expect(existsSync(lockPathFor(dir))).toBe(false);
  });

  it("keeps its schedule when a sync throws", async () => {
    const dir = workDir();
    const lines: string[] = [];
    let runs = 0;

    await daemon({
      interval: "1m",
      configDir: dir,
      log: (line) => lines.push(line),
      maxRuns: 2,
      runSync: async () => {
        runs += 1;
        throw new Error("no network");
      },
      wait: async () => {},
    });

    expect(runs).toBe(2);
    expect(lines.join("\n")).toContain("no network");
  });

  it("refuses a bad interval before taking the lock", async () => {
    const dir = workDir();
    const lines: string[] = [];
    const code = await daemon({ interval: "soon", configDir: dir, log: (l) => lines.push(l) });
    expect(code).toBe(1);
    expect(existsSync(lockPathFor(dir))).toBe(false);
    expect(lines.join("\n")).toContain("30s");
  });

  it("refuses to start beside a running daemon", async () => {
    const dir = workDir();
    // pid 1 is always running, and belongs to someone else, which is the case
    // the daemon has to get right: `kill(1, 0)` raises EPERM, not ESRCH.
    acquireLock(lockPathFor(dir), 1);
    const lines: string[] = [];
    const code = await daemon({
      interval: "1m",
      configDir: dir,
      log: (line) => lines.push(line),
      maxRuns: 1,
      runSync: async () => 0,
      wait: async () => {},
    });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("already running");
  });
});

describe("installSnippet", () => {
  const context = {
    execPath: "/usr/local/bin/node",
    scriptPath: "/usr/local/lib/node_modules/tokenburnmarket/dist/index.js",
    interval: "15m",
    home: "/home/dev",
  };

  it("prints a launchd job on macOS, pointing at this node and this script", () => {
    const printed = installSnippet({ ...context, platform: "darwin" }).join("\n");
    expect(printed).toContain("com.tokenburnmarket.daemon");
    expect(printed).toContain(context.execPath);
    expect(printed).toContain(context.scriptPath);
    expect(printed).toContain("launchctl load -w");
    expect(printed).toContain("/home/dev/Library/LaunchAgents/");
  });

  it("prints a systemd user unit elsewhere", () => {
    const printed = installSnippet({ ...context, platform: "linux" }).join("\n");
    expect(printed).toContain("[Service]");
    expect(printed).toContain(`ExecStart=${context.execPath} ${context.scriptPath} daemon`);
    expect(printed).toContain("systemctl --user enable --now tokenburnmarket");
  });

  it("carries the interval into the unit", () => {
    expect(installSnippet({ ...context, platform: "linux", interval: "1h" }).join("\n")).toContain(
      "--interval 1h",
    );
  });
});

describe("installDaemon", () => {
  const context = {
    execPath: "/usr/local/bin/node",
    scriptPath: "/usr/local/lib/node_modules/tokenburnmarket/dist/index.js",
    interval: "15m",
  };

  it("writes and loads the launchd job on macOS", () => {
    const home = workDir();
    const calls: string[] = [];
    const lines: string[] = [];

    const code = installDaemon(
      { ...context, platform: "darwin", home },
      {
        log: (line) => lines.push(line),
        run: (command, args) => {
          calls.push([command, ...args].join(" "));
          return { status: 0, stderr: "" };
        },
      },
    );

    const path = join(home, "Library/LaunchAgents/com.tokenburnmarket.daemon.plist");
    expect(code).toBe(0);
    const plist = readFileSync(path, "utf8");
    expect(plist).toContain("com.tokenburnmarket.daemon");
    expect(plist).toContain("<key>PATH</key>");
    expect(plist).toContain("/usr/local/bin");
    expect(calls).toContain(`launchctl load -w ${path}`);
    expect(lines.join("\n")).toContain("Installed and started");
  });

  it("writes and enables the systemd user service on Linux", () => {
    const home = workDir();
    const calls: string[] = [];

    const code = installDaemon(
      { ...context, platform: "linux", home },
      {
        log: () => {},
        run: (command, args) => {
          calls.push([command, ...args].join(" "));
          return { status: 0, stderr: "" };
        },
      },
    );

    const path = join(home, ".config/systemd/user/tokenburnmarket.service");
    expect(code).toBe(0);
    expect(readFileSync(path, "utf8")).toContain("ExecStart=/usr/local/bin/node");
    expect(calls).toEqual([
      "systemctl --user daemon-reload",
      "systemctl --user enable --now tokenburnmarket",
    ]);
  });

  it("fails loudly when the service manager refuses the install", () => {
    const lines: string[] = [];
    const code = installDaemon(
      { ...context, platform: "darwin", home: workDir() },
      {
        log: (line) => lines.push(line),
        run: () => ({ status: 1, stderr: "service manager refused" }),
      },
    );

    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("service manager refused");
    expect(lines.join("\n")).not.toContain("Installed and started");
  });

  it("refuses to persist a temporary npx cache path", () => {
    const home = workDir();
    let called = false;
    const code = installDaemon(
      {
        ...context,
        platform: "darwin",
        home,
        scriptPath: join(home, ".npm/_npx/temporary/node_modules/tokenburnmarket/dist/index.js"),
      },
      {
        log: () => {},
        run: () => {
          called = true;
          return { status: 0, stderr: "" };
        },
      },
    );

    expect(code).toBe(1);
    expect(called).toBe(false);
    expect(existsSync(join(home, "Library/LaunchAgents/com.tokenburnmarket.daemon.plist"))).toBe(
      false,
    );
  });
});
