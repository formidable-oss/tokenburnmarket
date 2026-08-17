/*
  `tokenburnmarket hook install`: sync when a Claude Code session stops.

  A Stop hook is the right moment. The work is finished, the transcript is
  written, and the sync costs nothing the person is waiting on. It runs with
  `--quiet` so a normal session prints nothing new.

  This edits a file someone else owns, so the rules are strict: parse, merge,
  write back, and never drop a key we did not put there. Running install twice
  changes nothing, and uninstall removes exactly what install added.
*/
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** What the hook runs. Kept in one place so install and uninstall cannot drift. */
export const HOOK_COMMAND = "tokenburnmarket sync --quiet";

/** The event: Claude Code fires Stop once the agent has finished responding. */
export const HOOK_EVENT = "Stop";

interface HookCommand {
  type?: string;
  command?: string;
  [key: string]: unknown;
}

interface HookMatcher {
  hooks?: HookCommand[];
  [key: string]: unknown;
}

export interface ClaudeSettings {
  hooks?: Record<string, HookMatcher[]>;
  [key: string]: unknown;
}

/**
 * Where Claude Code keeps its user settings. `TBM_CLAUDE_SETTINGS` overrides it,
 * which is what tests use rather than writing into a real home directory.
 */
export function claudeSettingsPath(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const override = env.TBM_CLAUDE_SETTINGS?.trim();
  return override && override.length > 0 ? override : join(home, ".claude", "settings.json");
}

/** Ours if it runs this CLI's sync, whatever flags someone has since added to it. */
function isOurs(entry: HookCommand): boolean {
  return typeof entry.command === "string" && /\btokenburnmarket\b.*\bsync\b/.test(entry.command);
}

export interface Merge {
  settings: ClaudeSettings;
  changed: boolean;
}

/** Add the Stop hook if it is not already there. Everything else is left alone. */
export function withStopHook(settings: ClaudeSettings): Merge {
  const hooks = { ...(settings.hooks ?? {}) };
  const matchers = [...(hooks[HOOK_EVENT] ?? [])];

  if (matchers.some((matcher) => (matcher.hooks ?? []).some(isOurs))) {
    return { settings, changed: false };
  }

  matchers.push({ hooks: [{ type: "command", command: HOOK_COMMAND }] });
  hooks[HOOK_EVENT] = matchers;
  return { settings: { ...settings, hooks }, changed: true };
}

/**
 * Take the Stop hook back out. Empty containers are removed with it, so an
 * uninstall on a file that had no hooks before leaves no trace of one.
 */
export function withoutStopHook(settings: ClaudeSettings): Merge {
  const existing = settings.hooks?.[HOOK_EVENT];
  if (!existing) return { settings, changed: false };

  let changed = false;
  const matchers: HookMatcher[] = [];
  for (const matcher of existing) {
    const kept = (matcher.hooks ?? []).filter((entry) => !isOurs(entry));
    if (kept.length !== (matcher.hooks ?? []).length) changed = true;
    // A matcher that only ever held our hook goes with it.
    if (kept.length > 0) matchers.push({ ...matcher, hooks: kept });
    else if (matcher.hooks === undefined) matchers.push(matcher);
  }
  if (!changed) return { settings, changed: false };

  const hooks = { ...settings.hooks };
  if (matchers.length > 0) hooks[HOOK_EVENT] = matchers;
  else delete hooks[HOOK_EVENT];

  const next: ClaudeSettings = { ...settings, hooks };
  if (Object.keys(hooks).length === 0) delete next.hooks;
  return { settings: next, changed: true };
}

/** Read the settings file, or an empty object when there is not one yet. */
export function readSettings(path: string): ClaudeSettings {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return {};
  }
  const parsed: unknown = JSON.parse(raw);
  // A file that is not an object is someone else's problem, and overwriting it
  // would lose whatever it is. Refuse loudly instead.
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path} is not a JSON object. Fix it, then run this again.`);
  }
  return parsed as ClaudeSettings;
}

export function writeSettings(path: string, settings: ClaudeSettings): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

export interface HookOptions {
  path?: string;
  log?: (line: string) => void;
}

export function installHook(options: HookOptions = {}): number {
  const log = options.log ?? ((line: string) => console.log(line));
  const path = options.path ?? claudeSettingsPath();

  const merged = withStopHook(readSettings(path));
  if (!merged.changed) {
    log(`Already installed. ${path} runs \`${HOOK_COMMAND}\` on Stop.`);
    return 0;
  }

  writeSettings(path, merged.settings);
  log(`Added a Stop hook to ${path}:`);
  log(`  ${HOOK_COMMAND}`);
  log("Claude Code will sync this machine when a session finishes.");
  return 0;
}

export function uninstallHook(options: HookOptions = {}): number {
  const log = options.log ?? ((line: string) => console.log(line));
  const path = options.path ?? claudeSettingsPath();

  const merged = withoutStopHook(readSettings(path));
  if (!merged.changed) {
    log(`Nothing to remove. ${path} has no tokenburnmarket hook.`);
    return 0;
  }

  writeSettings(path, merged.settings);
  log(`Removed the Stop hook from ${path}.`);
  return 0;
}
