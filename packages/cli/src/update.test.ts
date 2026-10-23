import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLI_VERSION,
  checkForUpdate,
  compareVersions,
  installMethod,
  runningProcessNotice,
  runUpdateCommand,
  update,
  updateCommand,
  updateNotice,
} from "./update";

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return { ...original, spawnSync: vi.fn(original.spawnSync) };
});

const temporary: string[] = [];
function cachePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "tbm-update-"));
  temporary.push(dir);
  return join(dir, "update-check.json");
}
afterEach(() => {
  vi.mocked(spawnSync).mockRestore();
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function registry(version: string | null): { fetch: typeof fetch; calls: number } {
  const state = { calls: 0 };
  const fetchImpl = (async () => {
    state.calls += 1;
    if (version === null) throw new Error("offline");
    return new Response(JSON.stringify({ name: "tokenburnmarket", version }), { status: 200 });
  }) as typeof fetch;
  return {
    fetch: fetchImpl,
    get calls() {
      return state.calls;
    },
  };
}

const NOW = new Date("2026-10-23T12:00:00.000Z");

describe("compareVersions", () => {
  it("orders by major, minor and patch, numerically", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.3.0", "0.3.0")).toBe(0);
    expect(compareVersions("0.2.5", "0.3.0")).toBeLessThan(0);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
  });

  it("puts a prerelease before its release", () => {
    expect(compareVersions("0.4.0-beta.1", "0.4.0")).toBeLessThan(0);
    expect(compareVersions("0.4.0", "0.4.0-beta.1")).toBeGreaterThan(0);
  });
});

describe("CLI_VERSION", () => {
  it("is the version in package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(CLI_VERSION).toBe(pkg.version);
  });
});

describe("checkForUpdate", () => {
  it("asks the registry once a day and caches the answer", async () => {
    const path = cachePath();
    const npm = registry("0.4.0");
    const first = await checkForUpdate({ cachePath: path, current: "0.3.0", now: NOW, env: {}, fetch: npm.fetch });
    const later = new Date(NOW.getTime() + 23 * 3600_000);
    const second = await checkForUpdate({ cachePath: path, current: "0.3.0", now: later, env: {}, fetch: npm.fetch });

    expect(first).toEqual({ current: "0.3.0", latest: "0.4.0", outdated: true });
    expect(second).toEqual(first);
    expect(npm.calls).toBe(1);

    const nextDay = new Date(NOW.getTime() + 25 * 3600_000);
    await checkForUpdate({ cachePath: path, current: "0.3.0", now: nextDay, env: {}, fetch: npm.fetch });
    expect(npm.calls).toBe(2);
  });

  it("answers null when the registry cannot be reached, and caches nothing", async () => {
    const path = cachePath();
    const result = await checkForUpdate({ cachePath: path, now: NOW, env: {}, fetch: registry(null).fetch });
    expect(result).toBeNull();
    expect(() => readFileSync(path)).toThrow();
  });

  it("is off in CI and when TBM_NO_UPDATE_CHECK is set", async () => {
    const npm = registry("9.9.9");
    for (const env of [{ CI: "true" }, { CI: "1" }, { TBM_NO_UPDATE_CHECK: "1" },
      { TBM_NO_UPDATE_CHECK: "false" }, { TBM_NO_UPDATE_CHECK: "0" }]) {
      expect(await checkForUpdate({ cachePath: cachePath(), env, fetch: npm.fetch })).toBeNull();
    }
    expect(npm.calls).toBe(0);
  });

  it.each(["false", "0", " FALSE ", " 0 "])("checks for updates when CI=%s", async (CI) => {
    const npm = registry("9.9.9");
    const result = await checkForUpdate({ cachePath: cachePath(), current: "0.3.0", env: { CI }, fetch: npm.fetch });
    expect(result?.outdated).toBe(true);
    expect(npm.calls).toBe(1);
  });

  it("ignores a broken cache file", async () => {
    const path = cachePath();
    writeFileSync(path, "{not json");
    const result = await checkForUpdate({ cachePath: path, current: "0.4.0", now: NOW, env: {}, fetch: registry("0.4.0").fetch });
    expect(result?.outdated).toBe(false);
  });
});

describe("installMethod", () => {
  it("reads the package manager from the install path", () => {
    expect(installMethod("/Users/a/.bun/install/global/node_modules/tokenburnmarket/dist/index.js")).toBe("bun");
    expect(installMethod("/usr/local/lib/node_modules/tokenburnmarket/dist/index.js")).toBe("npm");
    expect(installMethod("/Users/a/.local/share/mise/installs/node/26/lib/node_modules/tokenburnmarket/dist/index.js")).toBe("npm");
    expect(installMethod("C:\\Users\\a\\AppData\\Roaming\\npm\\node_modules\\tokenburnmarket\\dist\\index.js")).toBe("npm");
    expect(installMethod("/Users/a/Library/pnpm/global/5/node_modules/tokenburnmarket/dist/index.js")).toBe("pnpm");
    expect(installMethod("/Users/a/.config/yarn/global/node_modules/tokenburnmarket/dist/index.js")).toBe("yarn");
    expect(installMethod("/Users/a/.npm/_npx/abc/node_modules/tokenburnmarket/dist/index.js")).toBe("npx");
    expect(installMethod("/Users/a/code/tokenburnmarket/packages/cli/dist/index.js")).toBe("unknown");
    expect(installMethod("/Users/a/app/node_modules/tokenburnmarket/dist/index.js")).toBe("unknown");
  });
});

describe("updateCommand", () => {
  const base = { execPath: "/nonexistent/bin/node", home: "/nonexistent-home", env: {}, platform: "darwin" as const };

  it("uses the package manager that installed the CLI", () => {
    expect(updateCommand({ ...base, method: "npm" })?.args).toEqual(["install", "--global", "tokenburnmarket@latest"]);
    expect(updateCommand({ ...base, method: "bun" })?.display).toBe("bun add --global tokenburnmarket@latest");
    expect(updateCommand({ ...base, method: "pnpm" })?.display).toBe("pnpm add --global tokenburnmarket@latest");
    expect(updateCommand({ ...base, method: "yarn" })?.display).toBe("yarn global add tokenburnmarket@latest");
  });

  it("has nothing to run for npx or a local copy", () => {
    expect(updateCommand({ ...base, method: "npx" })).toBeNull();
    expect(updateCommand({ ...base, method: "unknown" })).toBeNull();
  });
});

describe("runUpdateCommand", () => {
  it("quotes an absolute Windows npm.cmd path that contains spaces", () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "win32" });
    vi.mocked(spawnSync).mockReturnValueOnce({ status: 0, stdout: "updated", stderr: "" } as ReturnType<typeof spawnSync>);
    const command = {
      command: "C:\\Program Files\\nodejs\\npm.cmd",
      args: ["install", "--global", "tokenburnmarket@latest"],
      display: "npm install --global tokenburnmarket@latest",
    };
    try {
      expect(runUpdateCommand(command, false)).toEqual({ status: 0, output: "updated" });
      expect(spawnSync).toHaveBeenCalledWith('"C:\\Program Files\\nodejs\\npm.cmd"', command.args,
        expect.objectContaining({ shell: true, stdio: "pipe" }));
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  });

  it("runs an executable fixture whose path contains spaces", () => {
    const directory = join(cachePath(), "Program Files");
    mkdirSync(directory, { recursive: true });
    const command = join(directory, process.platform === "win32" ? "npm.cmd" : "npm");
    writeFileSync(command, process.platform === "win32"
      ? "@echo off\r\necho %1 %2 %3\r\n"
      : '#!/bin/sh\nprintf "%s %s %s\\n" "$1" "$2" "$3"\n');
    chmodSync(command, 0o700);
    expect(runUpdateCommand({ command, args: ["install", "--global", "tokenburnmarket@latest"], display: "fixture" }, false))
      .toEqual({ status: 0, output: "install --global tokenburnmarket@latest" });
  });
});

describe("notices", () => {
  const outdated = { current: "0.3.0", latest: "0.4.0", outdated: true };

  it("says how to update, for the way the CLI was installed", () => {
    expect(updateNotice(outdated, "bun")).toBe(
      "tokenburnmarket 0.4.0 is available (this is 0.3.0). Update with: tokenburnmarket update",
    );
    expect(updateNotice(outdated, "npx")).toContain("npx tokenburnmarket@latest");
    expect(updateNotice({ ...outdated, outdated: false }, "npm")).toBeNull();
    expect(updateNotice(null, "npm")).toBeNull();
  });

  it("asks a long-running process to restart once the new version is on disk", () => {
    expect(runningProcessNotice(outdated, "npm", "0.3.0", "Restart it.")).toContain("Update with");
    expect(runningProcessNotice(outdated, "npm", "0.4.0", "Restart it.")).toBe(
      "tokenburnmarket 0.4.0 is installed, but this process still runs 0.3.0. Restart it.",
    );
  });
});

describe("update", () => {
  const context = {
    method: "npm" as const,
    execPath: "/nonexistent/bin/node",
    home: "/nonexistent-home",
    env: {},
    platform: "darwin" as const,
  };

  it("runs the install and restarts the daemon", async () => {
    const lines: string[] = [];
    const ran: string[] = [];
    const code = await update({
      cachePath: cachePath(),
      context,
      fetch: registry("99.0.0").fetch,
      log: (line) => lines.push(line),
      run: (command) => {
        ran.push(command.display);
        return { status: 0, output: "" };
      },
      restartDaemon: () => "Restarted the daemon.",
    });
    expect(code).toBe(0);
    expect(ran).toEqual(["npm install --global tokenburnmarket@latest"]);
    expect(lines).toContain("Updated to 99.0.0.");
    expect(lines).toContain("Restarted the daemon.");
  });

  it("changes nothing on a dry run or when already current", async () => {
    let runs = 0;
    const run = () => {
      runs += 1;
      return { status: 0, output: "" };
    };
    const lines: string[] = [];
    expect(
      await update({ cachePath: cachePath(), context, fetch: registry("99.0.0").fetch, log: (l) => lines.push(l), run, dryRun: true }),
    ).toBe(0);
    expect(
      await update({ cachePath: cachePath(), context, fetch: registry(CLI_VERSION).fetch, log: (l) => lines.push(l), run }),
    ).toBe(0);
    expect(runs).toBe(0);
    expect(lines.at(-1)).toBe(`tokenburnmarket ${CLI_VERSION} is the latest version.`);
  });

  it("still checks when background checks are turned off", async () => {
    const previous = process.env.TBM_NO_UPDATE_CHECK;
    process.env.TBM_NO_UPDATE_CHECK = "1";
    try {
      const lines: string[] = [];
      await update({ cachePath: cachePath(), context, fetch: registry(CLI_VERSION).fetch, log: (l) => lines.push(l) });
      expect(lines).toEqual([`tokenburnmarket ${CLI_VERSION} is the latest version.`]);
    } finally {
      if (previous === undefined) delete process.env.TBM_NO_UPDATE_CHECK;
      else process.env.TBM_NO_UPDATE_CHECK = previous;
    }
  });
});
