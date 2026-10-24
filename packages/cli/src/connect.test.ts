import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readConfig, writeConfig, type DeviceConfig } from "./config";
import { connect } from "./connect";

const SERVER = "https://example.test";

/** A server that hands out one code and approves it on the first poll. */
function approvingServer(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/connect/start") {
      return Response.json({
        code: "ABCD-1234",
        url: `${SERVER}/connect/ABCD-1234`,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      });
    }
    if (path === "/api/connect/ABCD-1234") {
      return Response.json({
        status: "approved",
        deviceId: "5b0d0f4a-4a6c-4a5e-9f2e-0f0e6b7a1c2d",
        deviceToken: "token",
        handle: "ada",
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

function run(options: { runSync?: (config: DeviceConfig) => Promise<number> } = {}) {
  const configPath = join(mkdtempSync(join(tmpdir(), "tbm-connect-")), "config.json");
  const lines: string[] = [];
  const synced: DeviceConfig[] = [];
  const result = connect({
    serverUrl: SERVER,
    deviceName: "workbench",
    configPath,
    fetch: approvingServer(),
    pollIntervalMs: 0,
    log: (line) => lines.push(line),
    runSync: async (config) => {
      synced.push(config);
      return options.runSync ? options.runSync(config) : 0;
    },
  });
  return { result, lines, synced, configPath };
}

describe("connect", () => {
  it("keeps this machine's key when it reconnects to the same server", async () => {
    const configPath = join(mkdtempSync(join(tmpdir(), "tbm-connect-")), "config.json");
    const sent: string[] = [];
    const lines: string[] = [];
    const server = approvingServer();
    const recording = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input)).pathname === "/api/connect/start") {
        sent.push((JSON.parse(String(init?.body)) as { publicKey: string }).publicKey);
      }
      return server(input, init);
    }) as typeof fetch;
    const once = (serverUrl: string) =>
      connect({
        serverUrl,
        deviceName: "workbench",
        configPath,
        fetch: recording,
        pollIntervalMs: 0,
        log: (line) => lines.push(line),
        runSync: async () => 0,
      });

    const first = await once(SERVER);
    writeConfig({ ...first, lastSyncedDay: "2026-08-20", lastSyncedAt: "2026-08-20T12:00:00.000Z" }, configPath);
    const again = await once(SERVER);
    expect(sent[1]).toBe(sent[0]);
    expect(again.privateKey).toBe(first.privateKey);
    // The same Device keeps its watermark, so its next sync is not the whole history.
    expect(again.lastSyncedDay).toBe("2026-08-20");
    expect(lines).toContain("Approve the code to reconnect the same device.");

    const elsewhere = await once("https://other.example.test");
    expect(sent[2]).not.toBe(sent[0]);
    expect(elsewhere.privateKey).not.toBe(first.privateKey);
    expect(elsewhere.lastSyncedDay).toBeUndefined();
    expect(lines).toContain("Connecting to another server replaces the stored device.");
  });

  it("asks before connecting to the account that approved the code, and saves nothing on no", async () => {
    const configPath = join(mkdtempSync(join(tmpdir(), "tbm-connect-")), "config.json");
    const questions: string[] = [];
    const attempt = (answer: boolean) =>
      connect({
        serverUrl: SERVER,
        deviceName: "workbench",
        configPath,
        fetch: approvingServer(),
        pollIntervalMs: 0,
        log: () => {},
        runSync: async () => 0,
        confirm: async (question) => {
          questions.push(question);
          return answer;
        },
      });

    await expect(attempt(false)).rejects.toThrow("Not connected, and nothing was saved.");
    expect(readConfig(configPath)).toBeNull();
    expect(questions).toEqual(["Connect this machine to @ada? [y/N] "]);

    expect((await attempt(true)).handle).toBe("ada");
    expect(readConfig(configPath)?.handle).toBe("ada");
  });

  it("syncs once approved, then says where to look", async () => {
    const { result, lines, synced } = run();
    const config = await result;

    expect(synced).toHaveLength(1);
    expect(synced[0]!.deviceId).toBe(config.deviceId);

    const text = lines.join("\n");
    expect(text).toContain("connected as @ada");
    expect(text).toContain(`Your profile: ${SERVER}/@ada`);
    expect(text).toContain("claude mcp add tokenburnmarket -- npx -y tokenburnmarket mcp");
    expect(text).toContain("tokenburnmarket daemon install");
    expect(text).not.toContain("hook");
  });

  it("is still connected when the first sync fails", async () => {
    const { result, lines, configPath } = run({
      runSync: async () => {
        throw new Error("getaddrinfo ENOTFOUND example.test");
      },
    });
    await result;

    expect(readConfig(configPath)?.handle).toBe("ada");
    const text = lines.join("\n");
    expect(text).toContain("getaddrinfo ENOTFOUND example.test");
    expect(text).toContain("tokenburnmarket sync");
    expect(text).toContain("claude mcp add tokenburnmarket");
  });
});
