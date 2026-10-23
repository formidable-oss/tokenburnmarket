import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireLock,
  daemon,
  installDaemon,
  installSnippet,
  keepUpToDate,
  lockPathFor,
} from "./daemon";
import { currentUpdateContext } from "./update";

const temporary: string[] = [];

function workDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "tbm-daemon-"));
  temporary.push(dir);
  return dir;
}

function pnpmFixture(sharedStore = false) {
  const home = workDir();
  const pnpmHome = join(home, "pnpm home");
  const global = join(pnpmHome, "global/v11");
  const active = join(global, "hash");
  const bin = join(pnpmHome, "bin");
  mkdirSync(bin, { recursive: true });
  const packages = ["0.3.0", "0.4.0"].map((version, index) => {
    const group = join(global, `install-${index}`);
    const packagePath = sharedStore
      ? join(home, "custom-store/links", `${version}-hash/node_modules/tokenburnmarket`)
      : join(group, "node_modules/tokenburnmarket");
    mkdirSync(join(packagePath, "dist"), { recursive: true });
    writeFileSync(join(packagePath, "package.json"), JSON.stringify({ name: "tokenburnmarket", version }));
    writeFileSync(join(packagePath, "dist/index.js"), `console.log(${JSON.stringify(version)});\n`);
    if (sharedStore) {
      mkdirSync(join(group, "node_modules"), { recursive: true });
      symlinkSync(packagePath, join(group, "node_modules/tokenburnmarket"));
    }
    return { group, packagePath };
  });
  symlinkSync(packages[0]!.group, active);
  const managerBin = join(home, "manager-bin");
  mkdirSync(managerBin);
  const pnpm = join(managerBin, "pnpm");
  writeFileSync(pnpm, `#!${process.execPath}
const fs = require("node:fs");
if (process.argv[2] === "bin") console.log(${JSON.stringify(bin)});
else if (process.argv[2] === "list") {
  console.error("fixture warning on stderr");
  console.log(JSON.stringify([{ dependencies: { tokenburnmarket: {
    path: fs.realpathSync(${JSON.stringify(join(active, "node_modules/tokenburnmarket"))})
  } } }]));
} else process.exit(1);
`);
  chmodSync(pnpm, 0o700);
  const launcher = join(bin, "tokenburnmarket");
  writeFileSync(launcher, `#!/bin/sh\nexec "${process.execPath}" "${join(active, "node_modules/tokenburnmarket/dist/index.js")}" "$@"\n`);
  chmodSync(launcher, 0o700);
  return {
    home, pnpmHome, launcher, managerBin,
    scriptPath: realpathSync(join(packages[0]!.packagePath, "dist/index.js")),
    context: { method: "pnpm" as const, execPath: process.execPath, home,
      platform: process.platform,
      env: { ...process.env, PNPM_HOME: pnpmHome, PATH: `${managerBin}:${process.env.PATH ?? ""}` } },
    replace: () => {
      rmSync(active);
      symlinkSync(packages[1]!.group, active);
    },
  };
}

afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
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
  it("syncs once per slot and releases the lock at the end", async () => {
    const dir = workDir();
    const waits: number[] = [];
    let runs = 0;

    const code = await daemon({
      afterSync: async () => false,
      configDir: dir,
      log: () => {},
      maxRuns: 3,
      untilNextSlot: () => 60_000,
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
      afterSync: async () => false,
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

  it("stops after the pass that installed a newer version", async () => {
    const dir = workDir();
    let runs = 0;
    const code = await daemon({
      afterSync: async () => true,
      configDir: dir,
      log: () => {},
      maxRuns: 3,
      runSync: async () => {
        runs += 1;
        return 0;
      },
      wait: async () => {},
    });
    expect(code).toBe(0);
    expect(runs).toBe(1);
    expect(existsSync(lockPathFor(dir))).toBe(false);
  });

  it("refuses to start beside a running daemon", async () => {
    const dir = workDir();
    // pid 1 is always running, and belongs to someone else, which is the case
    // the daemon has to get right: `kill(1, 0)` raises EPERM, not ESRCH.
    acquireLock(lockPathFor(dir), 1);
    const lines: string[] = [];
    const code = await daemon({
      afterSync: async () => false,
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
    home: "/home/dev",
    env: {},
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

  it("leaves the schedule to the daemon rather than the unit", () => {
    expect(installSnippet({ ...context, platform: "linux" }).join("\n")).not.toContain("--interval");
  });

  it("preserves usage roots without copying credentials into launchd", () => {
    const printed = installSnippet({ ...context, platform: "darwin", env: {
      CODEX_HOME: "~/Codex & archive,~/other",
      PI_CODING_AGENT_DIR: "~/pi",
      OPENAI_API_KEY: "must-not-be-persisted",
    } }).join("\n");
    expect(printed).toContain("<key>CODEX_HOME</key><string>/home/dev/Codex &amp; archive,/home/dev/other</string>");
    expect(printed).toContain("<key>PI_AGENT_DIR</key><string>/home/dev/pi/sessions</string>");
    expect(printed).not.toContain("must-not-be-persisted");
  });

  it("quotes custom directories in systemd environment values", () => {
    const printed = installSnippet({ ...context, platform: "linux", env: {
      CODEX_HOME: '/data/50% "archive"',
      CURSOR_API_KEY: "must-not-be-persisted",
    } }).join("\n");
    expect(printed).toContain('Environment="CODEX_HOME=/data/50%% \\"archive\\""');
    expect(printed).not.toContain("must-not-be-persisted");
  });

  it.each(["darwin", "linux"] as const)("keeps relative roots stable after %s service startup", (platform) => {
    const printed = installSnippet({ ...context, platform, cwd: "/project", env: {
      CODEX_HOME: "./codex,../archive", AGENT_CLI_CREDENTIAL_STORE: "file",
    } }).join("\n");
    expect(printed).toContain("/project/codex,/archive");
    expect(printed).not.toContain("/project/file");
  });
});

describe("installDaemon", () => {
  const context = {
    execPath: "/usr/local/bin/node",
    scriptPath: "/usr/local/lib/node_modules/tokenburnmarket/dist/index.js",
  };

  it.skipIf(process.platform === "win32").each(["darwin", "linux"] as const)(
    "uses the active pnpm install after an update with %s", (platform) => {
      const fixture = pnpmFixture(true);
      expect(installDaemon({ ...fixture.context, platform, scriptPath: fixture.scriptPath }, {
        log: () => {}, run: () => ({ status: 0, stderr: "" }),
      })).toBe(0);
      const service = platform === "darwin"
        ? join(fixture.home, "Library/LaunchAgents/com.tokenburnmarket.daemon.plist")
        : join(fixture.home, ".config/systemd/user/tokenburnmarket.service");
      const definition = readFileSync(service, "utf8");
      expect(definition).toContain(fixture.launcher);
      expect(definition).not.toContain(fixture.scriptPath);
      expect(definition).toContain("PNPM_HOME");
      expect(definition).toContain(fixture.managerBin);
      const args = platform === "darwin"
        ? [...definition.split("<key>ProgramArguments</key>")[1]!.split("</array>")[0]!
          .matchAll(/<string>(.*?)<\/string>/g)].map((match) => match[1]!)
        : [...definition.match(/^ExecStart=(.*)$/m)![1]!.matchAll(/"([^"]+)"|(\S+)/g)]
          .map((match) => match[1] ?? match[2]!);
      expect(spawnSync(args[0]!, args.slice(1), { encoding: "utf8" }).stdout.trim()).toBe("0.3.0");
      fixture.replace();
      expect(spawnSync(args[0]!, args.slice(1), { encoding: "utf8" }).stdout.trim()).toBe("0.4.0");
    },
  );

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

describe("keepUpToDate", () => {
  const context = {
    method: "npm" as const,
    execPath: "/nonexistent/bin/node",
    home: "/nonexistent-home",
    env: {},
    platform: "darwin" as const,
  };
  const outdated = { current: "0.3.0", latest: "0.4.0", outdated: true };
  const launchd = { XPC_SERVICE_NAME: "com.tokenburnmarket.daemon" };

  it.skipIf(process.platform === "win32").each([false, true])(
    "reads the active pnpm version after an isolated update, shared store=%s", async (sharedStore) => {
      const fixture = pnpmFixture(sharedStore);
      const lines: string[] = [];
      expect(await keepUpToDate({
        log: (line) => lines.push(line), attempted: new Set(), env: launchd,
        running: "0.3.0", check: async () => outdated, context: fixture.context,
        run: () => {
          fixture.replace();
          return { status: 0, output: "" };
        },
      })).toBe(true);
      expect(lines.at(-1)).toBe("0.4.0 is installed. Restarting on it.");
      expect(JSON.parse(readFileSync(join(dirname(dirname(fixture.scriptPath)), "package.json"), "utf8")).version)
        .toBe("0.3.0");
    },
  );

  it.skipIf(process.platform === "win32")("identifies a pnpm global package in a custom shared store", () => {
    const fixture = pnpmFixture(true);
    const script = process.argv[1];
    const pnpmHome = process.env.PNPM_HOME;
    const path = process.env.PATH;
    process.argv[1] = fixture.scriptPath;
    process.env.PNPM_HOME = fixture.pnpmHome;
    process.env.PATH = fixture.context.env.PATH;
    try {
      expect(currentUpdateContext().method).toBe("pnpm");
    } finally {
      process.argv[1] = script!;
      if (pnpmHome === undefined) delete process.env.PNPM_HOME;
      else process.env.PNPM_HOME = pnpmHome;
      if (path === undefined) delete process.env.PATH;
      else process.env.PATH = path;
    }
  });

  it("installs the new version once and restarts under launchd", async () => {
    let onDisk = "0.3.0";
    const commands: string[] = [];
    const lines: string[] = [];
    const attempted = new Set<string>();
    const run = (command: { display: string }) => {
      commands.push(command.display);
      onDisk = "0.4.0";
      return { status: 0, output: "" };
    };
    const options = {
      log: (line: string) => lines.push(line),
      attempted,
      env: launchd,
      running: "0.3.0",
      installed: () => onDisk,
      check: async () => outdated,
      context,
      run,
    };

    expect(await keepUpToDate(options)).toBe(true);
    expect(commands).toEqual(["npm install --global tokenburnmarket@latest"]);
    expect(lines).toEqual([
      "Updating to 0.4.0: npm install --global tokenburnmarket@latest",
      "Installed 0.4.0.",
      "0.4.0 is installed. Restarting on it.",
    ]);
  });

  it("tries a failing update once per version", async () => {
    const lines: string[] = [];
    const attempted = new Set<string>();
    let tries = 0;
    const options = {
      log: (line: string) => lines.push(line),
      attempted,
      env: launchd,
      running: "0.3.0",
      installed: () => "0.3.0",
      check: async () => outdated,
      context,
      run: () => {
        tries += 1;
        return { status: 1, output: "EACCES" };
      },
    };

    expect(await keepUpToDate(options)).toBe(false);
    expect(await keepUpToDate(options)).toBe(false);
    expect(tries).toBe(1);
    expect(lines[1]).toBe(
      "The update failed: EACCES Run it yourself: npm install --global tokenburnmarket@latest",
    );
  });

  it("only logs a notice when auto-update is off", async () => {
    const lines: string[] = [];
    let tries = 0;
    const result = await keepUpToDate({
      log: (line) => lines.push(line),
      attempted: new Set(),
      env: { ...launchd, TBM_NO_AUTO_UPDATE: "1" },
      running: "0.3.0",
      installed: () => "0.3.0",
      check: async () => outdated,
      context,
      run: () => {
        tries += 1;
        return { status: 0, output: "" };
      },
    });
    expect(result).toBe(false);
    expect(tries).toBe(0);
    expect(lines).toEqual([
      "tokenburnmarket 0.4.0 is available (this is 0.3.0). Update with: tokenburnmarket update",
    ]);
  });

  it("asks for a restart instead of exiting when nothing will start it again", async () => {
    const lines: string[] = [];
    const result = await keepUpToDate({
      log: (line) => lines.push(line),
      attempted: new Set(),
      env: {},
      running: "0.3.0",
      installed: () => "0.4.0",
      check: async () => ({ ...outdated, latest: "0.4.0" }),
      context,
    });
    expect(result).toBe(false);
    expect(lines).toEqual(["0.4.0 is installed. Restart the daemon to run it."]);
  });
});
