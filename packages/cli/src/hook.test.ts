import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  HOOK_COMMAND,
  HOOK_EVENT,
  claudeSettingsPath,
  installHook,
  uninstallHook,
  withStopHook,
  withoutStopHook,
} from "./hook";

const temporary: string[] = [];

function settingsFile(contents?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "tbm-hook-"));
  temporary.push(dir);
  const path = join(dir, "settings.json");
  if (contents !== undefined) writeFileSync(path, contents);
  return path;
}

const read = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("claudeSettingsPath", () => {
  it("defaults to the Claude Code user settings file", () => {
    expect(claudeSettingsPath({}, "/home/dev")).toBe("/home/dev/.claude/settings.json");
  });

  it("takes an override, which is how it is tested and how CI stays clean", () => {
    expect(claudeSettingsPath({ TBM_CLAUDE_SETTINGS: "/tmp/s.json" }, "/home/dev")).toBe(
      "/tmp/s.json",
    );
  });
});

describe("withStopHook", () => {
  it("adds the Stop hook and touches nothing else", () => {
    const before = { model: "opus", hooks: { PreToolUse: [{ hooks: [] }] } };
    const after = withStopHook(before);

    expect(after.changed).toBe(true);
    expect(after.settings.model).toBe("opus");
    expect(after.settings.hooks?.PreToolUse).toEqual([{ hooks: [] }]);
    expect(after.settings.hooks?.[HOOK_EVENT]).toEqual([
      { hooks: [{ type: "command", command: HOOK_COMMAND }] },
    ]);
  });

  it("is idempotent", () => {
    const once = withStopHook({});
    const twice = withStopHook(once.settings);
    expect(twice.changed).toBe(false);
    expect(twice.settings).toEqual(once.settings);
  });

  it("leaves someone else's Stop hooks in place", () => {
    const before = { hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] } };
    const after = withStopHook(before);
    expect(after.settings.hooks?.Stop).toHaveLength(2);
    expect(after.settings.hooks?.Stop?.[0]).toEqual(before.hooks.Stop[0]);
  });
});

describe("withoutStopHook", () => {
  it("reverses an install exactly", () => {
    const before = { model: "opus" };
    const installed = withStopHook(before);
    const removed = withoutStopHook(installed.settings);

    expect(removed.changed).toBe(true);
    expect(removed.settings).toEqual(before);
  });

  it("keeps other hooks in the same matcher", () => {
    const settings = {
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: "say done" },
              { type: "command", command: HOOK_COMMAND },
            ],
          },
        ],
      },
    };
    const removed = withoutStopHook(settings);
    expect(removed.settings.hooks?.Stop).toEqual([
      { hooks: [{ type: "command", command: "say done" }] },
    ]);
  });

  it("does nothing when there is nothing of ours", () => {
    const settings = { hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] } };
    expect(withoutStopHook(settings).changed).toBe(false);
    expect(withoutStopHook({}).changed).toBe(false);
  });
});

describe("installHook", () => {
  it("creates the file, then says so on a second run", () => {
    const path = settingsFile();
    const lines: string[] = [];

    expect(installHook({ path, log: (line) => lines.push(line) })).toBe(0);
    expect(read(path).hooks).toBeDefined();
    expect(lines.join("\n")).toContain(HOOK_COMMAND);

    const again: string[] = [];
    installHook({ path, log: (line) => again.push(line) });
    expect(again.join("\n")).toContain("Already installed");
    // Writing twice must not duplicate the hook.
    expect(JSON.stringify(read(path)).match(/tokenburnmarket sync/g)).toHaveLength(1);
  });

  it("preserves unrelated settings byte for byte in value", () => {
    const path = settingsFile(JSON.stringify({ model: "opus", env: { A: "1" } }));
    installHook({ path, log: () => {} });
    const after = read(path);
    expect(after.model).toBe("opus");
    expect(after.env).toEqual({ A: "1" });

    uninstallHook({ path, log: () => {} });
    expect(read(path)).toEqual({ model: "opus", env: { A: "1" } });
  });

  it("refuses a settings file that is not an object rather than overwriting it", () => {
    const path = settingsFile("[1, 2, 3]");
    expect(() => installHook({ path, log: () => {} })).toThrow(/not a JSON object/);
  });
});

describe("uninstallHook", () => {
  it("says so when there is nothing to remove", () => {
    const path = settingsFile("{}");
    const lines: string[] = [];
    expect(uninstallHook({ path, log: (line) => lines.push(line) })).toBe(0);
    expect(lines.join("\n")).toContain("Nothing to remove");
  });
});
