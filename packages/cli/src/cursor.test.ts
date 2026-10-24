import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readCursorUsage, type CursorUsageOptions } from "./cursor.js";

const TIME = Date.parse("2026-08-16T12:00:00.000Z");
const END = Date.parse("2026-08-18T12:00:00.000Z");
const tokenFor = (sub = "auth|fixture-account", signature = "fake-signature") =>
  `fake-header.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.${signature}`;
const TOKEN = tokenFor();
const event = (index = 0) => ({
  timestamp: String(TIME + index),
  model: "claude-sonnet-4-5",
  conversationId: "private-conversation",
  chargedCents: 0,
  tokenUsage: { inputTokens: 10, cacheReadTokens: 30, cacheWriteTokens: 2, outputTokens: 5, totalCents: 25 },
});
const fullPage = (offset = 0) => Array.from({ length: 1000 }, (_, index) => event(offset + index));
const pageBody = (events: unknown[], total = events.length) => ({
  totalUsageEventsCount: total,
  usageEventsDisplay: events,
});

function fixture(answer: (page: number, init: RequestInit) => unknown | Promise<unknown>) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
    const body = JSON.parse(String(init!.body));
    const result = await answer(body.page, init!);
    return result instanceof Response ? result : Response.json(result);
  });
  const readFile = vi.fn(async () => JSON.stringify({ accessToken: TOKEN }));
  const execFile = vi.fn<NonNullable<CursorUsageOptions["execFile"]>>(async () => TOKEN + "\n");
  const warn = vi.fn();
  const options: CursorUsageOptions = {
    env: {}, home: "/fixture/home", platform: "linux", now: () => END,
    fetch, readFile, execFile, warn,
  };
  return { options, fetch, readFile, execFile, warn };
}

function receiptHashes(result: Awaited<ReturnType<typeof readCursorUsage>>): string[] {
  return [...result.receipts.values()].flatMap((stream) => [...stream]).sort();
}

afterEach(() => vi.useRealTimers());

describe("readCursorUsage", () => {
  it("reads account history with disjoint counters and provider-reported cost", async () => {
    const test = fixture(() => pageBody([event()]));
    const result = await readCursorUsage({ ...test.options, since: "2026-08-16" });
    expect(result.aggregates).toEqual([{
      day: "2026-08-16", provider: "cursor", model: "claude-sonnet-4-5",
      inputTokens: 10, cachedInputTokens: 30, cacheWriteTokens: 2, outputTokens: 5,
      reasoningTokens: 0, costUsd: 0.25,
    }]);
    expect([...result.receipts.keys()]).toEqual(["2026-08-16 cursor claude-sonnet-4-5"]);
    expect(receiptHashes(result)).toEqual([expect.stringMatching(/^[a-f0-9]{64}$/)]);
    expect(JSON.stringify(receiptHashes(result))).not.toContain("private-conversation");
    expect(test.warn).not.toHaveBeenCalled();
    const [url, init] = test.fetch.mock.calls[0]!;
    expect(url).toBe("https://cursor.com/api/dashboard/get-filtered-usage-events");
    expect(init).toMatchObject({ method: "POST", redirect: "error", signal: expect.any(AbortSignal) });
    const headers = new Headers(init!.headers);
    expect(headers.get("origin")).toBe("https://cursor.com");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("cookie")).toBe(`WorkosCursorSessionToken=${encodeURIComponent(`fixture-account::${TOKEN}`)}`);
    expect(JSON.parse(String(init!.body))).toEqual({
      page: 1, pageSize: 1000, startDate: String(Date.parse("2026-08-16T00:00:00.000Z")), endDate: String(END),
    });
  });

  it("groups UTC days and models, filters the requested window, and does not estimate missing cost", async () => {
    const test = fixture(() => pageBody([
      { ...event(), timestamp: String(Date.parse("2026-08-16T23:59:59.999Z")) },
      { ...event(), timestamp: String(Date.parse("2026-08-17T00:00:00.000Z")) },
      { ...event(), model: "cursor-gpt-5-high", tokenUsage: { inputTokens: 7.9, outputTokens: 3 } },
      { ...event(), timestamp: String(TIME - 86_400_000) },
      { ...event(), timestamp: String(END + 1) },
      { tokenUsage: null },
    ]));
    const result = await readCursorUsage({ ...test.options, since: "2026-08-16" });
    expect(result.aggregates.map((row) => [row.day, row.model, row.costUsd])).toEqual([
      ["2026-08-16", "claude-sonnet-4-5", 0.25],
      ["2026-08-16", "cursor-gpt-5-high", 0],
      ["2026-08-17", "claude-sonnet-4-5", 0.25],
    ]);
    expect(result.aggregates[1]?.inputTokens).toBe(7);
    expect(receiptHashes(result)).toHaveLength(3);
    expect(test.warn).not.toHaveBeenCalled();
  });

  it("keeps identical billed events and hashes account and session identifiers", async () => {
    const test = fixture(() => pageBody([event(), event()]));
    const first = await readCursorUsage(test.options);
    const second = await readCursorUsage({ ...test.options, home: "/another-device", since: "2026-08-16", readFile: async () =>
      JSON.stringify({ accessToken: tokenFor("auth|fixture-account", "refreshed-token") }) });
    const other = await readCursorUsage({ ...test.options, readFile: async () =>
      JSON.stringify({ accessToken: tokenFor("auth|another-account") }) });
    expect(first.aggregates[0]).toMatchObject({ inputTokens: 20, outputTokens: 10, costUsd: 0.5 });
    expect(receiptHashes(first)).toHaveLength(2);
    expect(new Set(receiptHashes(first)).size).toBe(2);
    expect(receiptHashes(second)).toEqual(receiptHashes(first));
    expect(receiptHashes(other)).not.toEqual(receiptHashes(first));
    for (const hash of receiptHashes(first)) {
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      expect(hash).not.toMatch(/fixture-account|private-conversation|cursor-account/);
    }
  });

  it.each([2000, 2001])("removes only count-proven page overlap for total %i", async (total) => {
    const test = fixture((page) => pageBody(page === 1 ? fullPage() : page === 2 ? fullPage(999) : [event(1999)], total));
    const result = await readCursorUsage(test.options);
    expect(result.aggregates[0]?.inputTokens).toBe(total * 10);
    expect(receiptHashes(result)).toHaveLength(total);
    expect(test.fetch).toHaveBeenCalledTimes(3);
    expect(test.warn).not.toHaveBeenCalled();
  });

  it("matches boundary events even when JSON property order differs", async () => {
    const last = event(999);
    const reordered = { tokenUsage: { totalCents: 25, outputTokens: 5, cacheWriteTokens: 2, cacheReadTokens: 30, inputTokens: 10 },
      chargedCents: 0, conversationId: last.conversationId, model: last.model, timestamp: last.timestamp };
    const test = fixture((page) => pageBody(page === 1 ? fullPage() : [reordered, event(1000)], 1001));
    const result = await readCursorUsage(test.options);
    expect(receiptHashes(result)).toHaveLength(1001);
    expect(test.warn).not.toHaveBeenCalled();
  });

  it("requires a terminal page after an exact full page", async () => {
    const test = fixture((page) => page === 1 ? pageBody(fullPage(), 1000) : { totalUsageEventsCount: 1000 });
    const result = await readCursorUsage(test.options);
    expect(test.fetch).toHaveBeenCalledTimes(2);
    expect(receiptHashes(result)).toHaveLength(1000);
    expect(test.warn).not.toHaveBeenCalled();
  });

  it("reads history beyond 100 pages", async () => {
    const test = fixture((page) => pageBody(Array.from({ length: page <= 100 ? 1000 : 1 }, () => ({ tokenUsage: null })), 100_001));
    const result = await readCursorUsage(test.options);
    expect(result.aggregates).toEqual([]);
    expect(test.fetch).toHaveBeenCalledTimes(101);
    expect(test.warn).not.toHaveBeenCalled();
  });

  it.each([{}, { totalUsageEventsCount: 0 }, pageBody([]), { usageEventsDisplay: [] }])(
    "accepts an empty response %j", async (body) => {
      const test = fixture(() => body);
      expect(await readCursorUsage(test.options)).toEqual({ aggregates: [], receipts: new Map() });
      expect(test.warn).not.toHaveBeenCalled();
    },
  );

  it.each([
    { error: TOKEN }, { message: TOKEN }, { code: "denied" }, { detail: "unknown envelope" },
    null, [], "invalid", { totalUsageEventsCount: -1, usageEventsDisplay: [] },
    { totalUsageEventsCount: 1.5, usageEventsDisplay: [] },
    { totalUsageEventsCount: 1, usageEventsDisplay: [] },
    { totalUsageEventsCount: 0, usageEventsDisplay: [event()] },
    pageBody(Array.from({ length: 1001 }, () => event())),
  ])("rejects invalid or incomplete page %j without data or secrets", async (body) => {
    const test = fixture(() => body);
    expect(await readCursorUsage(test.options)).toEqual({ aggregates: [], receipts: new Map() });
    expect(test.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(test.warn.mock.calls)).not.toContain(TOKEN);
  });

  it.each(["count", "overlap", "http", "json", "network"])("discards earlier totals after a %s failure", async (failure) => {
    const test = fixture((page) => {
      if (page === 1) return pageBody(fullPage(), 1001);
      if (failure === "count") return pageBody([event(1000)], 1002);
      if (failure === "overlap") return pageBody([event(500), event(1000)], 1001);
      if (failure === "http") return new Response(TOKEN, { status: 500 });
      if (failure === "json") return new Response("not json");
      throw new Error(TOKEN);
    });
    expect(await readCursorUsage(test.options)).toEqual({ aggregates: [], receipts: new Map() });
    expect(test.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(test.warn.mock.calls)).not.toContain(TOKEN);
  });

  it.each([401, 403])("requests a new login after HTTP %i without exposing the body", async (status) => {
    const test = fixture(() => new Response(TOKEN, { status }));
    expect((await readCursorUsage(test.options)).aggregates).toEqual([]);
    expect(test.warn).toHaveBeenCalledWith("Sign in to Cursor again to read account usage.");
  });

  it.each([
    { inputTokens: -1 }, { outputTokens: "5" }, { cacheReadTokens: null },
    { cacheWriteTokens: -2 }, { totalCents: -1 },
  ])("rejects invalid counters %j without partial totals", async (bad) => {
    const test = fixture(() => pageBody([event(), { ...event(1), tokenUsage: { ...event().tokenUsage, ...bad } }]));
    expect(await readCursorUsage(test.options)).toEqual({ aggregates: [], receipts: new Map() });
    expect(test.warn).toHaveBeenCalledTimes(1);
  });

  it.each([{ timestamp: "" }, { model: "" }, { tokenUsage: [] }, { tokenUsage: "invalid" }])(
    "rejects a malformed event %j", async (bad) => {
      const test = fixture(() => pageBody([event(), { ...event(), ...bad }]));
      expect(await readCursorUsage(test.options)).toEqual({ aggregates: [], receipts: new Map() });
      expect(test.warn).toHaveBeenCalledTimes(1);
    },
  );

  it("reads up to six pages in parallel and consumes them in page order", async () => {
    let open = 0;
    let peak = 0;
    const test = fixture(async (page) => {
      open++;
      peak = Math.max(peak, open);
      for (let turn = page; turn < 9; turn++) await Promise.resolve();
      open--;
      return pageBody(page === 9 ? [event(8000)] : fullPage((page - 1) * 1000), 8001);
    });
    const result = await readCursorUsage(test.options);
    expect(peak).toBe(6);
    expect(receiptHashes(result)).toHaveLength(8001);
    expect(test.warn).not.toHaveBeenCalled();
  });

  it("aborts outstanding pages when one page fails", async () => {
    let open = 0;
    const test = fixture((page, init) => {
      if (page === 1) return pageBody(fullPage(), 8001);
      if (page === 2) throw new Error(TOKEN);
      open++;
      return new Promise((_, reject) => init.signal!.addEventListener("abort", () => {
        open--;
        reject(init.signal!.reason);
      }, { once: true }));
    });
    expect(await readCursorUsage(test.options)).toEqual({ aggregates: [], receipts: new Map() });
    expect(open).toBe(0);
    expect(test.warn).toHaveBeenCalledTimes(1);
  });

  it("bounds a stalled request and aborts its signal", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const test = fixture((_page, init) => {
      signal = init.signal!;
      return new Promise(() => {});
    });
    const pending = readCursorUsage(test.options);
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await pending).toEqual({ aggregates: [], receipts: new Map() });
    expect(signal?.aborted).toBe(true);
    expect(test.warn).toHaveBeenCalledWith("Cursor account usage read timed out.");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds the whole read when credentials stall", async () => {
    vi.useFakeTimers();
    const test = fixture(() => pageBody([]));
    const pending = readCursorUsage({ ...test.options, readFile: () => new Promise(() => {}) });
    await vi.advanceTimersByTimeAsync(60_001);
    expect(await pending).toEqual({ aggregates: [], receipts: new Map() });
    expect(test.fetch).not.toHaveBeenCalled();
    expect(test.warn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates caller cancellation and cancels outstanding requests", async () => {
    const controller = new AbortController();
    const test = fixture((_page, init) => {
      controller.abort(new Error("caller stopped"));
      expect(init.signal).toBeTruthy();
      return new Promise(() => {});
    });
    await expect(readCursorUsage({ ...test.options, signal: controller.signal })).rejects.toThrow("caller stopped");
    expect(test.warn).not.toHaveBeenCalled();
    expect(test.fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("does not read credentials when the caller has already cancelled", async () => {
    const test = fixture(() => pageBody([]));
    const signal = AbortSignal.abort(new Error("already stopped"));
    await expect(readCursorUsage({ ...test.options, signal })).rejects.toThrow("already stopped");
    expect(test.readFile).not.toHaveBeenCalled();
    expect(test.execFile).not.toHaveBeenCalled();
    expect(test.fetch).not.toHaveBeenCalled();
    expect(test.warn).not.toHaveBeenCalled();
  });

  it.each(["2026-02-30", "yesterday", "2026-8-16", "2026-08-19", ""])("rejects invalid date %j before reading credentials", async (since) => {
    const test = fixture(() => pageBody([]));
    expect((await readCursorUsage({ ...test.options, since })).aggregates).toEqual([]);
    expect(test.warn).toHaveBeenCalledTimes(1);
    expect(test.readFile).not.toHaveBeenCalled();
    expect(test.fetch).not.toHaveBeenCalled();
  });
});

describe("Cursor saved login", () => {
  it.each([
    ["linux", {}, "/fixture/home/.config/cursor/auth.json"],
    ["linux", { XDG_CONFIG_HOME: "/fixture/config" }, "/fixture/config/cursor/auth.json"],
    ["linux", { XDG_CONFIG_HOME: "relative" }, "/fixture/home/.config/cursor/auth.json"],
    ["win32", {}, "/fixture/home/AppData/Roaming/Cursor/auth.json"],
    ["win32", { APPDATA: "/fixture/roaming" }, "/fixture/roaming/Cursor/auth.json"],
    ["darwin", { AGENT_CLI_CREDENTIAL_STORE: "file" }, "/fixture/home/.cursor/auth.json"],
  ] as const)("uses the %s credential file for %j", async (platform, env, path) => {
    const test = fixture(() => pageBody([]));
    await readCursorUsage({ ...test.options, platform, env });
    expect(test.readFile).toHaveBeenCalledWith(path, expect.any(AbortSignal));
    expect(test.execFile).not.toHaveBeenCalled();
    expect(test.warn).not.toHaveBeenCalled();
  });

  it.each([
    ["linux", { HOME: "/fixture/env-home" }, "/fixture/env-home/.config/cursor/auth.json"],
    ["win32", { USERPROFILE: "/fixture/profile" }, "/fixture/profile/AppData/Roaming/Cursor/auth.json"],
  ] as const)("uses the %s home from the supplied environment", async (platform, env, path) => {
    const test = fixture(() => pageBody([]));
    await readCursorUsage({ ...test.options, home: undefined, platform, env });
    expect(test.readFile).toHaveBeenCalledWith(path, expect.any(AbortSignal));
  });

  it("reads a temporary auth fixture through the real file reader", async () => {
    const home = await mkdtemp(join(tmpdir(), "tbm-cursor-"));
    try {
      await mkdir(join(home, ".config", "cursor"), { recursive: true });
      await writeFile(join(home, ".config", "cursor", "auth.json"), JSON.stringify({ accessToken: TOKEN }));
      const test = fixture(() => pageBody([event()]));
      const result = await readCursorUsage({ ...test.options, home, readFile: undefined });
      expect(result.aggregates[0]?.inputTokens).toBe(10);
      expect(test.warn).not.toHaveBeenCalled();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("reads the macOS CLI Keychain item with bounded subprocess options", async () => {
    const test = fixture(() => pageBody([event()]));
    const result = await readCursorUsage({ ...test.options, platform: "darwin" });
    expect(result.aggregates[0]?.inputTokens).toBe(10);
    expect(test.execFile).toHaveBeenCalledWith("/usr/bin/security",
      ["find-generic-password", "-s", "cursor-access-token", "-a", "cursor-user", "-w"],
      { encoding: "utf8", env: {}, signal: expect.any(AbortSignal), timeout: 10_000, killSignal: "SIGKILL", maxBuffer: 65_536 });
    expect(test.readFile).not.toHaveBeenCalled();
    expect(test.warn).not.toHaveBeenCalled();
  });

  it.each([{ CURSOR_AUTH_TOKEN: "unused-secret" }, { CURSOR_API_KEY: "unused-key" }, { AGENT_CLI_CREDENTIAL_STORE: "memory" }])(
    "does not read or send environment credentials for %j", async (env) => {
      const test = fixture(() => pageBody([]));
      expect(await readCursorUsage({ ...test.options, env, platform: "darwin" })).toEqual({ aggregates: [], receipts: new Map() });
      expect(test.readFile).not.toHaveBeenCalled();
      expect(test.execFile).not.toHaveBeenCalled();
      expect(test.fetch).not.toHaveBeenCalled();
      expect(test.warn).not.toHaveBeenCalled();
    },
  );

  it.each(["file", "keychain", "empty-file", "empty-keychain"])("returns empty data for missing %s login", async (source) => {
    const test = fixture(() => pageBody([]));
    if (source === "file") test.readFile.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
    if (source === "keychain") test.execFile.mockRejectedValue(Object.assign(new Error("missing"), { code: 44 }));
    if (source === "empty-file") test.readFile.mockResolvedValue("{}");
    if (source === "empty-keychain") test.execFile.mockResolvedValue("\n");
    expect(await readCursorUsage({ ...test.options, platform: source.includes("keychain") ? "darwin" : "linux" })).toEqual({ aggregates: [], receipts: new Map() });
    expect(test.fetch).not.toHaveBeenCalled();
    expect(test.warn).not.toHaveBeenCalled();
  });

  it.each(["denied", "invalid-json", "invalid-token", "no-subject", "oversized", "keychain-denied"])("warns without data or secrets for %s", async (failure) => {
    const test = fixture(() => pageBody([]));
    if (failure === "denied") test.readFile.mockRejectedValue(Object.assign(new Error(TOKEN), { code: "EACCES" }));
    if (failure === "invalid-json") test.readFile.mockResolvedValue(TOKEN);
    if (failure === "invalid-token") test.readFile.mockResolvedValue(JSON.stringify({ accessToken: "invalid" }));
    if (failure === "no-subject") test.readFile.mockResolvedValue(JSON.stringify({ accessToken: tokenFor("") }));
    if (failure === "oversized") test.readFile.mockResolvedValue(" ".repeat(65_537));
    if (failure === "keychain-denied") test.execFile.mockRejectedValue(new Error(TOKEN));
    expect(await readCursorUsage({ ...test.options, platform: failure === "keychain-denied" ? "darwin" : "linux" })).toEqual({ aggregates: [], receipts: new Map() });
    expect(test.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(test.warn.mock.calls)).not.toContain(TOKEN);
    expect(test.fetch).not.toHaveBeenCalled();
  });
});
