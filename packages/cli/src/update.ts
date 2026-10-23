/*
  Knowing when this Collector is out of date, and updating it.

  The latest version comes from the npm registry, not from the tokenburnmarket
  server: asking the server would wake the database outside the Sync Slots
  (ADR 0005). The answer is cached for a day in the config directory, so a
  machine asks npm at most once a day however many agents and terminals run
  the CLI.

  An update reinstalls the package with the package manager that installed it,
  found from where this file lives on disk. Running npm against a bun install
  would leave two copies and keep running the old one.
*/
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { APP_NAME, currentConfigDir } from "./config.js";

/**
 * This build's version. Read from package.json next to `dist/` or `src/`, so
 * it is the published version and there is no second place to bump.
 */
export function packageVersion(packageJson = new URL("../package.json", import.meta.url)): string {
  try {
    const parsed = JSON.parse(readFileSync(packageJson, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const CLI_VERSION = packageVersion();

/** Where the last registry answer is kept. */
export function updateCachePath(): string {
  return join(currentConfigDir(), "update-check.json");
}

/** Days between registry checks. */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REGISTRY_URL = `https://registry.npmjs.org/${APP_NAME}/latest`;
const REGISTRY_TIMEOUT_MS = 3000;

/**
 * Compare two `major.minor.patch` versions. A prerelease sorts before its
 * release. Returns a negative number, zero, or a positive number.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (version: string) => {
    const [core = "", prerelease] = version.trim().replace(/^v/, "").split("-", 2);
    const parts = core.split(".").map((part) => Number.parseInt(part, 10) || 0);
    return { parts: [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0], prerelease };
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i += 1) {
    const difference = left.parts[i]! - right.parts[i]!;
    if (difference !== 0) return difference;
  }
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === undefined) return 1;
  if (right.prerelease === undefined) return -1;
  return left.prerelease < right.prerelease ? -1 : 1;
}

export interface UpdateCheck {
  current: string;
  latest: string;
  /** True when `latest` is newer than `current`. */
  outdated: boolean;
}

interface CachedCheck {
  checkedAt: string;
  latest: string;
}

export interface CheckOptions {
  cachePath: string;
  current?: string;
  now?: Date;
  env?: NodeJS.ProcessEnv;
  /** Skip the cache and ask the registry. `tokenburnmarket update` does this. */
  force?: boolean;
  fetch?: typeof fetch;
}

/** Whether checks are off for this environment. CI runs are never told to update. */
export function updateChecksDisabled(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.TBM_NO_UPDATE_CHECK?.trim() || env.CI?.trim());
}

function readCache(path: string): CachedCheck | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<CachedCheck>;
    if (typeof parsed.checkedAt !== "string" || typeof parsed.latest !== "string") return null;
    return { checkedAt: parsed.checkedAt, latest: parsed.latest };
  } catch {
    return null;
  }
}

async function registryLatest(fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const response = await fetchImpl(REGISTRY_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  }
}

/**
 * The newest published version against this one, or null when checks are off
 * or npm could not be reached. Never throws: a failed check must not fail the
 * command it rides along with.
 */
export async function checkForUpdate(options: CheckOptions): Promise<UpdateCheck | null> {
  const env = options.env ?? process.env;
  if (updateChecksDisabled(env)) return null;
  const now = options.now ?? new Date();
  const current = options.current ?? CLI_VERSION;

  let latest: string | null = null;
  const cached = options.force ? null : readCache(options.cachePath);
  if (cached && now.getTime() - Date.parse(cached.checkedAt) < CHECK_INTERVAL_MS) {
    latest = cached.latest;
  } else {
    latest = await registryLatest(options.fetch ?? fetch);
    if (latest === null) return null;
    try {
      mkdirSync(dirname(options.cachePath), { recursive: true, mode: 0o700 });
      writeFileSync(
        options.cachePath,
        `${JSON.stringify({ checkedAt: now.toISOString(), latest } satisfies CachedCheck)}\n`,
        { mode: 0o600 },
      );
    } catch {
      // An unwritable cache means asking again next time, nothing worse.
    }
  }

  return { current, latest, outdated: compareVersions(latest, current) > 0 };
}

export type InstallMethod = "npm" | "bun" | "pnpm" | "yarn" | "npx" | "unknown";

/**
 * Which package manager installed the file at `scriptPath`, from its real
 * path. A source checkout or a project-local dependency is `unknown`: there
 * is no global install to replace.
 */
export function installMethod(scriptPath: string): InstallMethod {
  let path = scriptPath;
  try {
    path = realpathSync(scriptPath);
  } catch {
    // A path that does not resolve is judged as written.
  }
  const p = path.replace(/\\/g, "/");
  if (p.includes("/_npx/")) return "npx";
  if (p.includes("/.bun/install/global/")) return "bun";
  if (/\/pnpm\/global\/|\/\.pnpm-global\//.test(p)) return "pnpm";
  if (/\/yarn\/global\/|\/Yarn\/Data\/global\//.test(p)) return "yarn";
  if (p.includes(`/node_modules/${APP_NAME}/`) && /\/lib\/node_modules\/|\/npm\/node_modules\//.test(p)) {
    return "npm";
  }
  return "unknown";
}

export interface UpdateContext {
  method: InstallMethod;
  /** The node binary running this process. npm is installed next to it. */
  execPath: string;
  home: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
}

export interface UpdateCommand {
  command: string;
  args: string[];
  /** What a person would type. */
  display: string;
}

/** The first of `candidates` that exists, or the bare name to look up on PATH. */
function firstExisting(candidates: (string | undefined)[], name: string): string {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return name;
}

/**
 * The command that installs the latest version the way this one was installed.
 *
 * Binaries are looked up in their usual homes before PATH, because a service
 * manager starts the daemon with a short PATH that often leaves them out.
 */
export function updateCommand(context: UpdateContext): UpdateCommand | null {
  const spec = `${APP_NAME}@latest`;
  const windows = context.platform === "win32";
  switch (context.method) {
    case "npm": {
      const npm = firstExisting(
        [join(dirname(context.execPath), windows ? "npm.cmd" : "npm")],
        windows ? "npm.cmd" : "npm",
      );
      return { command: npm, args: ["install", "--global", spec], display: `npm install --global ${spec}` };
    }
    case "bun": {
      const bun = firstExisting(
        [
          context.env.BUN_INSTALL ? join(context.env.BUN_INSTALL, "bin", "bun") : undefined,
          join(context.home, ".bun", "bin", "bun"),
          join(context.home, ".local", "share", "mise", "shims", "bun"),
          "/opt/homebrew/bin/bun",
          "/usr/local/bin/bun",
        ],
        "bun",
      );
      return { command: bun, args: ["add", "--global", spec], display: `bun add --global ${spec}` };
    }
    case "pnpm":
      return {
        command: windows ? "pnpm.cmd" : "pnpm",
        args: ["add", "--global", spec],
        display: `pnpm add --global ${spec}`,
      };
    case "yarn":
      return {
        command: windows ? "yarn.cmd" : "yarn",
        args: ["global", "add", spec],
        display: `yarn global add ${spec}`,
      };
    default:
      return null;
  }
}

/** The line a person sees when a newer version exists, or null when there is nothing to say. */
export function updateNotice(check: UpdateCheck | null, method: InstallMethod): string | null {
  if (!check?.outdated) return null;
  const how =
    method === "npx"
      ? `Run it as npx ${APP_NAME}@latest to get it.`
      : method === "unknown"
        ? `Update with: npm install --global ${APP_NAME}@latest`
        : `Update with: ${APP_NAME} update`;
  return `${APP_NAME} ${check.latest} is available (this is ${check.current}). ${how}`;
}

/**
 * The notice for a long-running process, which keeps the code it started
 * with. Once the new version is on disk, the person does not need to update
 * again, only to restart whatever runs the old one.
 */
export function runningProcessNotice(
  check: UpdateCheck | null,
  method: InstallMethod,
  installed: string,
  restart: string,
): string | null {
  if (!check?.outdated) return null;
  if (compareVersions(installed, check.latest) >= 0) {
    return `${APP_NAME} ${installed} is installed, but this process still runs ${check.current}. ${restart}`;
  }
  return updateNotice(check, method);
}

export interface RunResult {
  status: number | null;
  output: string;
}

/** Run an update command. `inherit` shows its output live, for a person at a terminal. */
export function runUpdateCommand(command: UpdateCommand, inherit: boolean): RunResult {
  const result = spawnSync(command.command, command.args, {
    encoding: "utf8",
    stdio: inherit ? "inherit" : "pipe",
    // npm.cmd and friends are batch files, which Windows only runs through a shell.
    shell: process.platform === "win32",
    timeout: 5 * 60 * 1000,
  });
  const output = [result.stdout, result.stderr, result.error?.message]
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .join("\n")
    .trim();
  return { status: result.status, output };
}

/** The current context for this process. */
export function currentUpdateContext(): UpdateContext {
  return {
    method: installMethod(process.argv[1] ?? ""),
    execPath: process.execPath,
    home: homedir(),
    env: process.env,
    platform: process.platform,
  };
}

export interface UpdateCommandOptions {
  dryRun?: boolean;
  cachePath?: string;
  context?: UpdateContext;
  log?: (line: string) => void;
  fetch?: typeof fetch;
  run?: (command: UpdateCommand, inherit: boolean) => RunResult;
  /** Restarts the background daemon, if one is installed, so it runs the new version. */
  restartDaemon?: () => string | null;
}

/** `tokenburnmarket update`: install the latest version the way this one was installed. */
export async function update(options: UpdateCommandOptions = {}): Promise<number> {
  const log = options.log ?? ((line: string) => console.log(line));
  const context = options.context ?? currentUpdateContext();
  // A person asked for this, so the switches that silence background checks do not apply.
  const check = await checkForUpdate({
    cachePath: options.cachePath ?? updateCachePath(),
    force: true,
    env: {},
    fetch: options.fetch,
  });
  if (!check) {
    log("Could not reach the npm registry. Try again later.");
    return 1;
  }
  if (!check.outdated) {
    log(`${APP_NAME} ${check.current} is the latest version.`);
    return 0;
  }

  const command = updateCommand(context);
  if (!command) {
    log(updateNotice(check, context.method) ?? "");
    if (context.method === "npx") log("npx runs the version you name, so there is nothing to install.");
    else log("This copy was not installed globally, so it cannot update itself.");
    return 1;
  }

  log(`Updating ${APP_NAME} ${check.current} to ${check.latest}: ${command.display}`);
  if (options.dryRun) return 0;
  const result = (options.run ?? runUpdateCommand)(command, true);
  if (result.status !== 0) {
    log(`The update failed${result.output ? `: ${result.output}` : "."} Run it yourself: ${command.display}`);
    return 1;
  }
  log(`Updated to ${check.latest}.`);
  const restarted = options.restartDaemon?.();
  if (restarted) log(restarted);
  log("Restart your agent sessions to load the new MCP server.");
  return 0;
}
