import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateDeviceKeyPair } from "@tokenburnmarket/core/signing";
import { beforeAll, describe, expect, it } from "vitest";
import type { UsageAggregate } from "./ccusage";
import { writeConfig, type DeviceConfig } from "./config";
import { pageDays, sync } from "./sync";

const NOW = new Date("2026-08-22T18:00:00.000Z");
const TEN_MINUTES = 10 * 60_000;

// Nothing here may spawn the real meter. A command that cannot exist makes
// any un-injected read fail loudly instead of quietly running ccusage.
const ENV = { TBM_CCUSAGE: "/nonexistent/ccusage" };

let keys: { publicKey: string; privateKey: string };
beforeAll(async () => {
  keys = await generateDeviceKeyPair();
});

function freshConfig(extra: Partial<DeviceConfig> = {}): { config: DeviceConfig; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "tbm-sync-"));
  const config: DeviceConfig = {
    serverUrl: "https://example.test",
    deviceId: "5b0d0f4a-4a6c-4a5e-9f2e-0f0e6b7a1c2d",
    deviceName: "workbench",
    handle: "ada",
    deviceToken: "token",
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    connectedAt: "2026-08-01T00:00:00.000Z",
    ...extra,
  };
  const path = join(dir, "config.json");
  writeConfig(config, path);
  return { config, path };
}

const ONE_DAY: UsageAggregate[] = [
  {
    day: "2026-08-22",
    provider: "claude",
    model: "claude-sonnet-5",
    inputTokens: 1000,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 200,
    reasoningTokens: 0,
    costUsd: 1.25,
  },
];

/** A server that accepts everything and moves the watermark to the day it got. */
function acceptingServer(): { fetch: typeof fetch; calls: number } {
  const state = { calls: 0 };
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    state.calls += 1;
    const body = JSON.parse(String(init?.body)) as { payload: { days: { day: string }[] } };
    return new Response(
      JSON.stringify({
        days: body.payload.days.map((day) => ({ ...day, trustLevel: "verified", reasons: [] })),
        nextWatermark: body.payload.days.at(-1)?.day ?? null,
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  return {
    fetch: fetchImpl,
    get calls() {
      return state.calls;
    },
  };
}

describe("sync throttle", () => {
  it("skips entirely when told to and it synced within the window", async () => {
    const { path } = freshConfig({
      lastSyncedAt: new Date(NOW.getTime() - 2 * 60_000).toISOString(),
    });
    let reads = 0;
    const server = acceptingServer();
    const lines: string[] = [];

    const code = await sync({
      configPath: path,
      now: () => NOW,
      env: ENV,
      home: tmpdir(),
      skipIfSyncedWithinMs: TEN_MINUTES,
      readUsage: async () => {
        reads += 1;
        return ONE_DAY;
      },
      fetch: server.fetch,
      log: (line) => lines.push(line),
    });

    expect(code).toBe(0);
    expect(reads).toBe(0);
    expect(server.calls).toBe(0);
    expect(lines.join("\n")).toMatch(/2 minutes ago/);
  });

  it("syncs when the last one is older than the window", async () => {
    const { path } = freshConfig({
      lastSyncedAt: new Date(NOW.getTime() - 11 * 60_000).toISOString(),
    });
    const server = acceptingServer();

    const code = await sync({
      configPath: path,
      now: () => NOW,
      env: ENV,
      home: tmpdir(),
      skipIfSyncedWithinMs: TEN_MINUTES,
      readUsage: async () => ONE_DAY,
      fetch: server.fetch,
      log: () => {},
    });

    expect(code).toBe(0);
    expect(server.calls).toBe(1);
  });

  it("never throttles a sync someone ran by hand", async () => {
    const { path } = freshConfig({ lastSyncedAt: NOW.toISOString() });
    const server = acceptingServer();

    await sync({
      configPath: path,
      now: () => NOW,
      env: ENV,
      home: tmpdir(),
      readUsage: async () => ONE_DAY,
      fetch: server.fetch,
      log: () => {},
    });

    expect(server.calls).toBe(1);
  });
});

describe("what a sync records", () => {
  it("stores when it synced alongside the watermark", async () => {
    const { path } = freshConfig();
    const server = acceptingServer();

    await sync({
      configPath: path,
      now: () => NOW,
      env: ENV,
      home: tmpdir(),
      readUsage: async () => ONE_DAY,
      fetch: server.fetch,
      log: () => {},
    });

    const stored = JSON.parse(readFileSync(path, "utf8")) as DeviceConfig;
    expect(stored.lastSyncedAt).toBe(NOW.toISOString());
    expect(stored.lastSyncedDay).toBe("2026-08-22");
  });

  it("records nothing on a dry run", async () => {
    const { path } = freshConfig();
    const server = acceptingServer();

    await sync({
      configPath: path,
      now: () => NOW,
      env: ENV,
      home: tmpdir(),
      dryRun: true,
      readUsage: async () => ONE_DAY,
      fetch: server.fetch,
      log: () => {},
    });

    const stored = JSON.parse(readFileSync(path, "utf8")) as DeviceConfig;
    expect(stored.lastSyncedAt).toBeUndefined();
    expect(server.calls).toBe(0);
  });
});

describe("brief output", () => {
  it("prints the total and skips the per-day table", async () => {
    const { path } = freshConfig();
    const server = acceptingServer();
    const lines: string[] = [];

    await sync({
      configPath: path,
      now: () => NOW,
      env: ENV,
      home: tmpdir(),
      brief: true,
      readUsage: async () => ONE_DAY,
      fetch: server.fetch,
      log: (line) => lines.push(line),
    });

    expect(lines.some((line) => line.startsWith("day "))).toBe(false);
    expect(lines.some((line) => line.includes("claude-sonnet-5"))).toBe(false);
    expect(lines.at(-1)).toBe("1 rows, $1.25, 0 receipts. @ada");
  });
});

describe("paging", () => {
  const THREE_DAYS: UsageAggregate[] = ["2026-08-20", "2026-08-21", "2026-08-22"].map((day) => ({
    ...ONE_DAY[0]!,
    day,
  }));

  /** Records every page it is sent, and moves the watermark like the real server. */
  function pagingServer() {
    const pages: { days: string[]; sentAt: string }[] = [];
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        payload: { sentAt: string; days: { day: string }[] };
      };
      pages.push({ days: body.payload.days.map((d) => d.day), sentAt: body.payload.sentAt });
      return Response.json({
        days: body.payload.days.map((day) => ({ ...day, trustLevel: "verified", reasons: [] })),
        nextWatermark: body.payload.days.at(-1)!.day,
      });
    }) as typeof fetch;
    return { fetch: fetchImpl, pages };
  }

  it("splits an upload that would not fit into ascending pages", async () => {
    const { path } = freshConfig();
    const server = pagingServer();
    const lines: string[] = [];
    const onePage = JSON.stringify({
      version: 1,
      deviceId: "5b0d0f4a-4a6c-4a5e-9f2e-0f0e6b7a1c2d",
      sentAt: NOW.toISOString(),
      days: [{ ...THREE_DAYS[0]!, receipts: [] }],
    }).length;

    const code = await sync({
      configPath: path,
      now: () => NOW,
      env: ENV,
      home: tmpdir(),
      // Room for one day and a bit, never two.
      maxPayloadBytes: Math.floor(onePage * 1.5),
      readUsage: async () => THREE_DAYS,
      fetch: server.fetch,
      log: (line) => lines.push(line),
    });

    expect(code).toBe(0);
    expect(server.pages.map((page) => page.days)).toEqual([
      ["2026-08-20"],
      ["2026-08-21"],
      ["2026-08-22"],
    ]);
    const stored = JSON.parse(readFileSync(path, "utf8")) as DeviceConfig;
    expect(stored.lastSyncedDay).toBe("2026-08-22");
    expect(lines).toContain("Uploading in 3 parts.");
    // One summary for the whole sync, not one per page.
    expect(lines.filter((line) => / receipts\. @/.test(line))).toEqual([
      "3 rows, $3.75, 0 receipts. @ada",
    ]);
  });

  it("sends everything in one request when it fits", async () => {
    const { path } = freshConfig();
    const server = pagingServer();

    await sync({
      configPath: path,
      now: () => NOW,
      env: ENV,
      home: tmpdir(),
      readUsage: async () => THREE_DAYS,
      fetch: server.fetch,
      log: () => {},
    });

    expect(server.pages).toHaveLength(1);
    expect(server.pages[0]!.days).toEqual(["2026-08-20", "2026-08-21", "2026-08-22"]);
  });

  it("keeps every request within the sync row limit", () => {
    const rows = Array.from({ length: 401 }, (_, index) => ({
      ...THREE_DAYS[0]!,
      model: `model-${index}`,
      receipts: [],
    }));

    expect(pageDays(rows, Number.POSITIVE_INFINITY).map((page) => page.length)).toEqual([400, 1]);
  });
});
