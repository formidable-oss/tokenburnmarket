import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { configPathFor, writeConfig } from "./config.js";

it("reads OpenCode SQLite receipts through the built CLI", () => {
  const home = mkdtempSync(join(tmpdir(), "tbm-usage-bundle-"));
  try {
    const root = join(home, "opencode");
    mkdirSync(root);
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const db = new DatabaseSync(join(root, "opencode.db"));
    try {
      db.exec("CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT)");
      db.prepare("INSERT INTO message VALUES (?, ?, ?)").run("message-1", "session-1", JSON.stringify({
        id: "message-1", role: "assistant", providerID: "openai", modelID: "gpt-5",
        time: { created: now.getTime() },
        tokens: { input: 1000, output: 200, reasoning: 150, cache: { read: 600, write: 0 } },
      }));
    } finally { db.close(); }
    const report = { daily: [{ period: day, agents: [{ agent: "opencode", totalTokens: 1950,
      modelBreakdowns: [{ modelName: "gpt-5", inputTokens: 1000, outputTokens: 200,
        cacheReadTokens: 600, cacheCreationTokens: 0, cost: 0.02 }],
    }] }] };
    const meter = join(home, "meter.cjs");
    writeFileSync(meter, `console.log(JSON.stringify(process.argv.includes('codex') ? {daily:[]} : ${JSON.stringify(report)}));`);
    const env = {
      PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home,
      APPDATA: home, XDG_CONFIG_HOME: home, XDG_DATA_HOME: home,
      OPENCODE_DATA_DIR: root, AGENT_CLI_CREDENTIAL_STORE: "memory",
      TBM_NO_UPDATE_CHECK: "1", TBM_CCUSAGE: `${process.execPath} ${meter}`,
    };
    writeConfig({ deviceId: "11111111-1111-4111-8111-111111111111", deviceToken: "test", privateKey: "test", publicKey: "test",
      serverUrl: "http://127.0.0.1:1", handle: "test", deviceName: "test", connectedAt: now.toISOString(),
    }, configPathFor({ platform: process.platform, env, home }));
    const entry = join(dirname(dirname(fileURLToPath(import.meta.url))), "dist", "index.js");
    const result = spawnSync(process.execPath, [entry, "sync", "--dry-run"], {
      env, encoding: "utf8", timeout: 15_000,
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const output = result.stdout;
    expect(output).toContain("opencode");
    expect(output).toContain("1 rows, 1 receipts. Nothing was uploaded.");
    expect(output).not.toContain("could not be read");
    expect(output).not.toContain("do not match");
  } finally { rmSync(home, { recursive: true, force: true }); }
}, 20_000);
