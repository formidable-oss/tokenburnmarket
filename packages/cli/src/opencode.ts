/*!
 * Adapted from the OpenCode readers in T3 Code and ccusage.
 * MIT License
 * Copyright (c) 2026 T3 Tools Inc.
 * Copyright (c) 2025 ryoppippi
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
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { opendir, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { setImmediate as yieldToLoop } from "node:timers/promises";
import type { DatabaseSync as Database } from "node:sqlite";
import { receiptKey } from "./receipts.js";

export interface OpenCodeDetails {
  reasoningTokens: number;
  receipts: Set<string>;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  /** ccusage's visible output counter. Reasoning is a separate counter. */
  outputTokens: number;
}

export interface OpenCodeReadResult {
  details: Map<string, OpenCodeDetails>;
  incompleteSources: string[];
}

export interface OpenCodeDetailsOptions {
  env: NodeJS.ProcessEnv;
  home: string;
  /** Oldest UTC day, in YYYY-MM-DD form. */
  since?: string;
  signal?: AbortSignal;
  warn?: (message: string) => void;
}

const PAGE_SIZE = 64;
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
const DB_NAME = /^opencode(?:-[a-zA-Z0-9_-]+)?\.db$/;
type Row = Record<string, unknown>;

function object(value: unknown): Row {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Row : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function missing(error: unknown): boolean {
  return object(error).code === "ENOENT";
}

function hasTable(db: Database, table: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;
}

function columns(db: Database, table: string): Set<unknown> {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
}

/** Each page releases its SQLite statement before the reader yields to other work. */
async function scanRows(
  db: Database,
  table: string,
  select: string,
  where: string,
  signal: AbortSignal | undefined,
  visit: (row: Row) => void,
): Promise<void> {
  const range = db.prepare(
    `SELECT (SELECT MIN(rowid) FROM ${table}) AS first, (SELECT MAX(rowid) FROM ${table}) AS last`,
  ).get();
  if (range?.first === null || range?.last === null) return;
  const first = range?.first;
  const last = range?.last;
  if (typeof first !== "number" || !Number.isSafeInteger(first - 1) ||
      typeof last !== "number" || !Number.isSafeInteger(last)) throw new Error("Invalid row range");
  const page = db.prepare(
    `SELECT rowid AS scan_rowid, ${select} FROM ${table}
     WHERE rowid > ? AND rowid <= ? ${where ? `AND (${where})` : ""}
     ORDER BY rowid LIMIT ${PAGE_SIZE}`,
  );
  let after = first - 1;
  while (after < last) {
    signal?.throwIfAborted();
    const rows = page.all(after, last);
    if (rows.length === 0) break;
    for (const row of rows) {
      signal?.throwIfAborted();
      visit(row);
    }
    const cursor = rows.at(-1)!.scan_rowid;
    if (typeof cursor !== "number" || !Number.isSafeInteger(cursor) || cursor <= after) {
      throw new Error("Invalid row cursor");
    }
    after = cursor;
    await yieldToLoop(undefined, { signal });
  }
}

async function forkCutoffs(db: Database, signal?: AbortSignal): Promise<Map<string, number>> {
  const cutoffs = new Map<string, number>();
  if (!hasTable(db, "session_v2") || !hasTable(db, "session_message")) return cutoffs;
  const sessionColumns = columns(db, "session_v2");
  const messageColumns = columns(db, "session_message");
  if (!["id", "fork_session_id", "fork_boundary"].every((name) => sessionColumns.has(name)) ||
      !["id", "session_id", "seq"].every((name) => messageColumns.has(name))) return cutoffs;
  const boundarySeq = db.prepare("SELECT seq FROM session_message WHERE session_id = ? AND id = ? LIMIT 1");
  const previousSeq = db.prepare("SELECT MAX(seq) AS seq FROM session_message WHERE session_id = ? AND seq < ?");
  await scanRows(db, "session_v2", "id, fork_session_id, fork_boundary",
    "fork_session_id IS NOT NULL AND fork_boundary IS NOT NULL", signal, (row) => {
      if (typeof row.id !== "string" || !row.id || typeof row.fork_session_id !== "string" ||
          !row.fork_session_id || typeof row.fork_boundary !== "string") return;
      let boundary: Row;
      try {
        boundary = object(JSON.parse(row.fork_boundary));
      } catch {
        return;
      }
      if (typeof boundary.messageID !== "string") return;
      const seq = boundarySeq.get(row.fork_session_id, boundary.messageID)?.seq;
      if (typeof seq !== "number" || !Number.isSafeInteger(seq)) return;
      const cutoff = boundary.type === "through" ? seq : boundary.type === "before"
        ? previousSeq.get(row.fork_session_id, seq)?.seq : undefined;
      if (typeof cutoff === "number" && Number.isSafeInteger(cutoff)) cutoffs.set(row.id, cutoff);
    });
  return cutoffs;
}

async function readMessageFile(path: string, signal?: AbortSignal): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  const stream = createReadStream(path, { end: MAX_MESSAGE_BYTES, signal });
  for await (const chunk of stream) {
    bytes += chunk.length;
    if (bytes > MAX_MESSAGE_BYTES) throw new Error("OpenCode message exceeds the read limit");
    chunks.push(chunk);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}

/**
 * Supplement ccusage with reasoning and SHA-256 receipts of `opencode:<message id>`.
 * Compare every visible counter with the ccusage snapshot before using these details.
 * An incomplete read reports its sources and withholds supplemental counters.
 */
export async function readOpenCodeDetails(options: OpenCodeDetailsOptions): Promise<OpenCodeReadResult> {
  const { env, home, since, signal } = options;
  signal?.throwIfAborted();
  if (since && (!/^\d{4}-\d{2}-\d{2}$/.test(since) ||
      !Number.isFinite(Date.parse(`${since}T00:00:00.000Z`)) ||
      new Date(`${since}T00:00:00.000Z`).toISOString().slice(0, 10) !== since)) {
    throw new RangeError("OpenCode since must be a UTC day in YYYY-MM-DD form");
  }
  const index = new Map<string, OpenCodeDetails>();
  const seen = new Set<string>();
  const incompleteSources = new Set<string>();
  const incomplete = (path: string) => {
    if (incompleteSources.size < 10) incompleteSources.add(path);
  };

  const append = (source: string, path: string, kind: "message" | "session_message" | "legacy", row: Row = {}): string | undefined => {
    let message: Row;
    try {
      message = object(JSON.parse(source));
    } catch {
      incomplete(path);
      return;
    }
    const tokens = object(message.tokens);
    const cache = object(tokens.cache);
    const reference = kind === "session_message" ? object(message.model) : {};
    const model = text(reference.id) || text(reference.modelID) || text(message.modelID);
    const provider = text(reference.providerID) || text(message.providerID);
    if (!model || !provider) return;
    const payloadCreated = object(message.time).created;
    // Only v2 uses the column timestamp when the payload has no integer timestamp.
    const created = typeof payloadCreated === "number" && Number.isSafeInteger(payloadCreated)
      ? payloadCreated : kind === "session_message" && typeof row.created === "number"
        ? Math.trunc(row.created) : 0;
    const timestamp = created > 0 ? created : 0;
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) {
      incomplete(path);
      return;
    }
    const day = date.toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      incomplete(path);
      return;
    }
    if (since && day < since) return;
    const id = kind === "legacy" ? text(message.id) : typeof row.id === "string" ? row.id : "";
    const hash = id ? createHash("sha256").update(`opencode:${id}`).digest("hex") : undefined;
    if (hash && seen.has(hash)) return id;
    if ([tokens.input, tokens.output, tokens.reasoning, tokens.total, cache.read, cache.write]
      .some((value) => typeof value === "number" && value > Number.MAX_SAFE_INTEGER)) incomplete(path);
    const inputTokens = count(tokens.input);
    const cachedInputTokens = count(cache.read);
    const cacheWriteTokens = count(cache.write);
    const reasoningTokens = count(tokens.reasoning);
    let outputTokens = count(tokens.output);
    const known = inputTokens + cachedInputTokens + cacheWriteTokens + reasoningTokens + outputTokens;
    // ccusage assigns a total-only residual to visible output when output is absent.
    const residual = Math.max(0, count(tokens.total) - known);
    if (outputTokens === 0) outputTokens = residual;
    else if (residual > 0) incomplete(path);
    if (inputTokens + cachedInputTokens + cacheWriteTokens + reasoningTokens + outputTokens === 0) return;
    if (hash) seen.add(hash);
    const key = receiptKey(day, "opencode", model);
    const details = index.get(key) ?? {
      inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0,
      outputTokens: 0, reasoningTokens: 0, receipts: new Set<string>(),
    };
    details.inputTokens += inputTokens;
    details.cachedInputTokens += cachedInputTokens;
    details.cacheWriteTokens += cacheWriteTokens;
    details.outputTokens += outputTokens;
    details.reasoningTokens += reasoningTokens;
    if (![details.inputTokens, details.cachedInputTokens, details.cacheWriteTokens,
      details.outputTokens, details.reasoningTokens].every(Number.isSafeInteger)) incomplete(path);
    if (hash) details.receipts.add(hash);
    index.set(key, details);
    return id || undefined;
  };

  const dataHome = env.XDG_DATA_HOME?.trim();
  const defaults = [join(dataHome && isAbsolute(dataHome) ? dataHome : join(home, ".local", "share"), "opencode")];
  // An explicitly empty override disables discovery, as it does in ccusage.
  const roots = env.OPENCODE_DATA_DIR === undefined ? defaults
    : env.OPENCODE_DATA_DIR.split(",").map((root) => root.trim()).filter(Boolean);
  const canonicalRoots = new Set<string>();
  for (const root of roots) {
    signal?.throwIfAborted();
    let canonical: string;
    try {
      canonical = await realpath(resolve(root));
    } catch (error) {
      if (!missing(error)) incomplete(root);
      continue;
    }
    if (canonicalRoots.has(canonical)) continue;
    canonicalRoots.add(canonical);
    const databases: string[] = [];
    try {
      const directory = await opendir(canonical);
      for await (const entry of directory) {
        signal?.throwIfAborted();
        if (entry.isFile() && DB_NAME.test(entry.name)) databases.push(entry.name);
      }
    } catch (error) {
      signal?.throwIfAborted();
      if (!missing(error)) incomplete(root);
      continue;
    }
    databases.sort((a, b) => a === b ? 0 : a === "opencode.db" ? -1 : b === "opencode.db" ? 1 : a.localeCompare(b));
    const databaseIds = new Set<string>();
    for (const name of databases) {
      signal?.throwIfAborted();
      const databasePath = join(canonical, name);
      let db: Database | undefined;
      try {
        const { DatabaseSync } = await import("node:sqlite");
        db = new DatabaseSync(databasePath, { readOnly: true });
        db.exec("PRAGMA busy_timeout = 100");
        const cutoffs = await forkCutoffs(db, signal);
        let foundTable = false;
        for (const table of ["message", "session_message"] as const) {
          if (!hasTable(db, table)) continue;
          foundTable = true;
          const fields = columns(db, table);
          const required = ["id", "session_id", "data", ...(table === "session_message" ? ["type"] : [])];
          if (!required.every((field) => fields.has(field))) {
            incomplete(databasePath);
            continue;
          }
          const created = fields.has("time_created") ? "time_created" : "NULL";
          const seq = table === "session_message" && fields.has("seq") ? "seq" : "NULL";
          await scanRows(db, table,
            `id, session_id, CASE WHEN length(CAST(data AS BLOB)) <= ${MAX_MESSAGE_BYTES} THEN data ELSE NULL END AS data,
             ${created} AS created, ${seq} AS seq`,
            table === "session_message" ? "type = 'assistant'" : "", signal, (row) => {
              const cutoff = typeof row.session_id === "string" ? cutoffs.get(row.session_id) : undefined;
              if (table === "session_message" && cutoff !== undefined &&
                  typeof row.seq === "number" && Number.isSafeInteger(row.seq) && row.seq <= cutoff) return;
              if (typeof row.id !== "string" || typeof row.session_id !== "string" || typeof row.data !== "string") {
                incomplete(databasePath);
                return;
              }
              const id = append(row.data, databasePath, table, row);
              if (id) databaseIds.add(id);
            });
        }
        if (!foundTable) incomplete(databasePath);
      } catch {
        signal?.throwIfAborted();
        incomplete(databasePath);
      } finally {
        try { db?.close(); } catch { incomplete(databasePath); }
      }
    }

    const walk = async (path: string, optional = false): Promise<void> => {
      signal?.throwIfAborted();
      try {
        const directory = await opendir(path);
        for await (const entry of directory) {
          signal?.throwIfAborted();
          if (entry.isDirectory()) await walk(join(path, entry.name));
          else if (entry.isFile() && entry.name.endsWith(".json")) {
            if (databaseIds.has(entry.name.slice(0, -5))) continue;
            const messagePath = join(path, entry.name);
            try {
              append(await readMessageFile(messagePath, signal), messagePath, "legacy");
            } catch {
              signal?.throwIfAborted();
              incomplete(messagePath);
            }
          }
        }
      } catch (error) {
        signal?.throwIfAborted();
        if (!optional || !missing(error)) incomplete(path);
      }
    };
    await walk(join(canonical, "storage", "message"), true);
  }
  signal?.throwIfAborted();
  if (incompleteSources.size > 0) {
    (options.warn ?? console.warn)(`OpenCode details are incomplete. Check these sources for unreadable data or unsupported records: ${[...incompleteSources].map((path) => JSON.stringify(path)).join(", ")}.`);
  }
  return { details: incompleteSources.size > 0 ? new Map() : index, incompleteSources: [...incompleteSources] };
}
