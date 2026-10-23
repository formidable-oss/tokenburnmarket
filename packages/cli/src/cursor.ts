/*!
 * Cursor account pagination and event identities adapted from T3 Code:
 * packages/provider-cursor/src/server/accountUsage.ts and CursorUsageAccounts.ts.
 *
 * MIT License
 * Copyright (c) 2026 T3 Tools Inc.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { execFile as nodeExecFile, type ExecFileOptionsWithStringEncoding } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile as nodeReadFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { setImmediate } from "node:timers/promises";
import type { UsageAggregate } from "./ccusage.js";
import { receiptKey, type ReceiptIndex } from "./receipts.js";

const USAGE_URL = "https://cursor.com/api/dashboard/get-filtered-usage-events";
const PAGE_SIZE = 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const READ_TIMEOUT_MS = 60_000;
const CREDENTIAL_LIMIT = 64 * 1024;

export interface CursorUsageOptions {
  /** First UTC day to read, YYYY-MM-DD. Omit to request all available account history. */
  since?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
  signal?: AbortSignal;
  warn?: (message: string) => void;
  /** Test injections. Normal calls use the host platform, filesystem, subprocess, and fetch. */
  platform?: NodeJS.Platform;
  now?: () => number;
  fetch?: typeof globalThis.fetch;
  readFile?: (path: string, signal: AbortSignal) => Promise<string>;
  execFile?: (
    file: string,
    args: readonly string[],
    options: ExecFileOptionsWithStringEncoding,
  ) => Promise<string>;
}

export interface CursorUsageResult {
  aggregates: UsageAggregate[];
  receipts: ReceiptIndex;
}

class CursorReadError extends Error {}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CursorReadError("Cursor returned invalid account usage data.");
  }
  return value as Record<string, unknown>;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hasCode(error: unknown, code: string | number): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

async function withTimeout<T>(
  parent: AbortSignal | undefined,
  milliseconds: number,
  read: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal;
  const timer = setTimeout(() => {
    controller.abort(new CursorReadError("Cursor account usage read timed out."));
  }, milliseconds);
  let onAbort: () => void = () => {};
  try {
    signal.throwIfAborted();
    return await Promise.race([
      Promise.resolve().then(() => read(signal)),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

const execKeychain: NonNullable<CursorUsageOptions["execFile"]> = (file, args, options) =>
  new Promise((resolve, reject) => {
    nodeExecFile(file, args, options, (error, stdout) => error ? reject(error) : resolve(stdout));
  });

async function accessToken(options: CursorUsageOptions, signal: AbortSignal): Promise<string | null> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const store = env.AGENT_CLI_CREDENTIAL_STORE;
  // These modes do not use the host CLI's saved account login.
  if (env.CURSOR_AUTH_TOKEN?.trim() || env.CURSOR_API_KEY?.trim() || store === "memory") return null;
  if (platform === "darwin" && store !== "file") {
    try {
      const token = await (options.execFile ?? execKeychain)(
        "/usr/bin/security",
        ["find-generic-password", "-s", "cursor-access-token", "-a", "cursor-user", "-w"],
        { encoding: "utf8", env, signal, timeout: REQUEST_TIMEOUT_MS, killSignal: "SIGKILL", maxBuffer: CREDENTIAL_LIMIT },
      );
      return token.trim() || null;
    } catch (error) {
      if (hasCode(error, 44)) return null;
      throw new CursorReadError("Cursor Keychain credentials could not be read. Check Keychain access on this Mac.");
    }
  }

  const home = options.home ?? ((platform === "win32" ? env.USERPROFILE : env.HOME) || homedir());
  const config = platform === "win32"
    ? env.APPDATA || join(home, "AppData", "Roaming")
    : env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(home, ".config");
  const path = platform === "darwin" ? join(home, ".cursor", "auth.json")
    : join(config, platform === "win32" ? "Cursor" : "cursor", "auth.json");
  try {
    const raw = await (options.readFile ?? ((file, abort) => nodeReadFile(file, { encoding: "utf8", signal: abort })))(path, signal);
    if (Buffer.byteLength(raw) > CREDENTIAL_LIMIT) throw new Error("Credential file exceeds the size limit.");
    const token = object(JSON.parse(raw)).accessToken;
    return typeof token === "string" && token.trim() ? token.trim() : null;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw new CursorReadError("Cursor saved credentials could not be read.");
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function boundaryOverlap(previous: readonly string[], current: readonly string[]): number {
  const sequence = [...current, "", ...previous];
  const lengths = Array.from({ length: sequence.length }, () => 0);
  for (let index = 1; index < sequence.length; index++) {
    let length = lengths[index - 1]!;
    while (length > 0 && sequence[index] !== sequence[length]) length = lengths[length - 1]!;
    if (sequence[index] === sequence[length]) length++;
    lengths[index] = length;
  }
  return lengths.at(-1) ?? 0;
}

async function readPages(
  token: string,
  userId: string,
  start: number,
  end: number,
  fetch: typeof globalThis.fetch,
  parent: AbortSignal,
): Promise<{ pages: unknown[][]; total: number | undefined }> {
  const controller = new AbortController();
  const signal = AbortSignal.any([parent, controller.signal]);
  let total: number | undefined;
  const readPage = (page: number) => withTimeout(signal, REQUEST_TIMEOUT_MS, async (abort) => {
    if (page > (total === undefined ? 1000 : Math.ceil(total / PAGE_SIZE) * 2 + 1)) {
      throw new CursorReadError("Cursor account usage exceeded the page limit.");
    }
    const response = await fetch(USAGE_URL, {
      method: "POST",
      redirect: "error",
      signal: abort,
      headers: {
        Origin: "https://cursor.com",
        "Content-Type": "application/json",
        Cookie: `WorkosCursorSessionToken=${encodeURIComponent(`${userId}::${token}`)}`,
      },
      body: JSON.stringify({ page, pageSize: PAGE_SIZE, startDate: String(start), endDate: String(end) }),
    });
    if (response.status === 401 || response.status === 403) {
      throw new CursorReadError("Sign in to Cursor again to read account usage.");
    }
    if (!response.ok) throw new CursorReadError("Cursor account usage request failed.");
    const body = object(await response.json());
    const keys = Object.keys(body);
    if ("error" in body || "message" in body || "code" in body) {
      throw new CursorReadError("Cursor returned an account usage error.");
    }
    const count = keys.length === 0 ? 0 : body.totalUsageEventsCount;
    const events = keys.length === 0 || (keys.length === 1 && keys[0] === "totalUsageEventsCount")
      ? [] : body.usageEventsDisplay;
    if ((count !== undefined && (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 ||
      (total !== undefined && count !== total))) || !Array.isArray(events) || events.length > PAGE_SIZE) {
      throw new CursorReadError("Cursor returned inconsistent account usage pages.");
    }
    if (typeof count === "number") total = count;
    return events as unknown[];
  });

  type PageResult = { events: unknown[] } | { error: unknown };
  const ahead: Promise<PageResult>[] = [];
  const pages: unknown[][] = [];
  try {
    for (let page = 1; ; page++) {
      while (ahead.length < Math.min(6, Math.ceil((total ?? 0) / PAGE_SIZE) - page + 1)) {
        ahead.push(readPage(page + ahead.length).then((events) => ({ events }), (error) => ({ error })));
      }
      const next = ahead.shift();
      const result: PageResult = next ? await next : { events: await readPage(page) };
      if ("error" in result) throw result.error;
      pages.push(result.events);
      // A full page requires a terminal page even if the count has been reached.
      if (result.events.length < PAGE_SIZE) return { pages, total };
    }
  } finally {
    controller.abort();
    await Promise.all(ahead);
  }
}

function usageCount(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new CursorReadError("Cursor returned invalid account usage totals.");
  }
  return Math.trunc(value);
}

async function collectPages(
  pages: unknown[][],
  total: number | undefined,
  account: string,
  start: number,
  end: number,
  signal: AbortSignal,
): Promise<CursorUsageResult> {
  const rawCount = pages.reduce((sum, page) => sum + page.length, 0);
  let removals = total === undefined ? 0 : rawCount - total;
  if (removals < 0) throw new CursorReadError("Cursor returned incomplete account usage pages.");
  let previous: string[] = [];
  const occurrences = new Map<string, number>();
  const aggregates = new Map<string, UsageAggregate>();
  const receipts: ReceiptIndex = new Map();
  for (const events of pages) {
    signal.throwIfAborted();
    const keys = removals > 0 ? events.map((event) => hash(canonicalJson(event))) : [];
    const overlap = Math.min(removals, boundaryOverlap(previous, keys));
    removals -= overlap;
    previous = keys;
    for (const raw of events.slice(overlap)) {
      const event = object(raw);
      if (event.tokenUsage === null || event.tokenUsage === undefined) continue;
      const usage = object(event.tokenUsage);
      const timestamp = typeof event.timestamp === "string" && event.timestamp.trim() ? Number(event.timestamp) : event.timestamp;
      if (typeof timestamp !== "number" || !Number.isFinite(timestamp) ||
        typeof event.model !== "string" || !event.model.trim()) {
        throw new CursorReadError("Cursor returned an invalid account usage event.");
      }
      const inputTokens = usageCount(usage.inputTokens);
      const cachedInputTokens = usageCount(usage.cacheReadTokens);
      const cacheWriteTokens = usageCount(usage.cacheWriteTokens);
      const outputTokens = usageCount(usage.outputTokens);
      usageCount(usage.totalCents);
      const costUsd = typeof usage.totalCents === "number" ? usage.totalCents / 100 : 0;
      if (timestamp < start || timestamp > end) continue;
      const day = new Date(timestamp).toISOString().slice(0, 10);
      const key = receiptKey(day, "cursor", event.model);
      const identity = hash(JSON.stringify([
        timestamp, event.model, typeof event.conversationId === "string" ? event.conversationId : "",
        inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens, usage.totalCents === undefined ? null : costUsd,
      ]));
      const occurrence = occurrences.get(identity) ?? 0;
      occurrences.set(identity, occurrence + 1);
      // Account scope deduplicates the same history on different machines and CLI logins.
      const receipt = hash(JSON.stringify(["cursor-account", account, identity, occurrence]));
      const stream = receipts.get(key) ?? new Set<string>();
      stream.add(receipt);
      receipts.set(key, stream);
      const row = aggregates.get(key) ?? {
        day, provider: "cursor", model: event.model, inputTokens: 0, cachedInputTokens: 0,
        cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0,
      };
      row.inputTokens += inputTokens;
      row.cachedInputTokens += cachedInputTokens;
      row.cacheWriteTokens += cacheWriteTokens;
      row.outputTokens += outputTokens;
      row.costUsd += costUsd;
      aggregates.set(key, row);
    }
    // Let cancellation and the read deadline run between pages of account history.
    await setImmediate(undefined, { signal });
  }
  if (removals !== 0) throw new CursorReadError("Cursor returned inconsistent account usage boundaries.");
  return { aggregates: [...aggregates.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => row), receipts };
}

/**
 * Read account-wide Cursor history with the host CLI's saved login. No credentials are written.
 * A failed source warns and returns no rows. Callers must not replace saved totals on a warning.
 * Cursor reports separate input and cache counters. Its output includes any reasoning tokens.
 * Missing provider cost is zero. No model price estimate is used.
 */
export async function readCursorUsage(options: CursorUsageOptions = {}): Promise<CursorUsageResult> {
  try {
    return await withTimeout(options.signal, READ_TIMEOUT_MS, async (signal) => {
      const start = options.since ? Date.parse(`${options.since}T00:00:00.000Z`) : 0;
      const end = (options.now ?? Date.now)();
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end ||
        (options.since !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(options.since) ||
          new Date(start).toISOString().slice(0, 10) !== options.since))) {
        throw new CursorReadError("Cursor account usage requires a valid UTC date window.");
      }
      const token = await accessToken(options, signal);
      if (!token) return { aggregates: [], receipts: new Map() };
      let subject: unknown;
      try {
        subject = object(JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"))).sub;
      } catch {
        throw new CursorReadError("Cursor saved login is invalid. Sign in to Cursor again.");
      }
      if (typeof subject !== "string" || !subject || !subject.split("|").at(-1)) {
        throw new CursorReadError("Cursor saved login is invalid. Sign in to Cursor again.");
      }
      const { pages, total } = await readPages(token, subject.split("|").at(-1)!, start, end, options.fetch ?? globalThis.fetch, signal);
      return collectPages(pages, total, hash(subject), start, end, signal);
    });
  } catch (error) {
    options.signal?.throwIfAborted();
    (options.warn ?? console.warn)(error instanceof CursorReadError ? error.message : "Cursor account usage could not be read.");
    return { aggregates: [], receipts: new Map() };
  }
}
