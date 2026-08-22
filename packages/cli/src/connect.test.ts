import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readConfig, type DeviceConfig } from "./config";
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
