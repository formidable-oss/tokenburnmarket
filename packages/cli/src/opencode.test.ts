import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readOpenCodeDetails, type OpenCodeDetailsOptions } from "./opencode.js";
import { receiptKey } from "./receipts.js";

const DAY = "2026-10-20";
const CREATED = Date.parse(`${DAY}T23:59:59.000Z`);
const MODEL = "claude-sonnet-4.5";
const KEY = receiptKey(DAY, "opencode", MODEL);
const ONE = "88030db7c9e9a96b65fa2f66d7661bbda2a068f1de5a9715dbc24822517c75fd";
const TWO = "bb7322ab77285c94232a67ff9cbfe3a5350c90bc9a2e2f2eceb917f6990ba3a4";
const SQL_ID = "e020f2d49834a0adfdfaee31d2080fc8ccd6755913c25f78fba6500ccc285a61";

function message(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "msg-one",
    sessionID: "session-one",
    role: "assistant",
    providerID: "anthropic",
    modelID: MODEL,
    time: { created: CREATED },
    tokens: { input: 100, output: 20, reasoning: 30, cache: { read: 40, write: 10 } },
    content: "PRIVATE PROMPT SENTINEL",
    ...overrides,
  };
}

let temporary: string;
let root: string;
let warn = vi.fn<(message: string) => void>();

function legacy(value: Record<string, unknown>, name = "msg-one", dataRoot = root): string {
  const path = join(dataRoot, "storage", "message", "session-one", `${name}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
  return path;
}

function database(name = "opencode.db", dataRoot = root): DatabaseSync {
  mkdirSync(dataRoot, { recursive: true });
  return new DatabaseSync(join(dataRoot, name));
}

function messageTable(db: DatabaseSync, withTimestamp = true): void {
  db.exec(`CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT${withTimestamp ? ", time_created INTEGER" : ""})`);
}

function insertMessage(db: DatabaseSync, id: string, payload = message(), created = CREATED): void {
  db.prepare("INSERT INTO message (id, session_id, data, time_created) VALUES (?, ?, ?, ?)")
    .run(id, "session-one", JSON.stringify(payload), created);
}

function v2Table(db: DatabaseSync, withTimestamp = true): void {
  db.exec(`CREATE TABLE session_message (
    id TEXT PRIMARY KEY, session_id TEXT, type TEXT, data TEXT, seq INTEGER${withTimestamp ? ", time_created INTEGER" : ""}
  )`);
}

async function read(options: Partial<OpenCodeDetailsOptions> = {}) {
  return (await readOpenCodeDetails({ env: { OPENCODE_DATA_DIR: root }, home: temporary, warn, ...options })).details;
}

beforeEach(() => {
  temporary = mkdtempSync(join(tmpdir(), "tbm-opencode-test-"));
  root = join(temporary, "opencode");
  warn = vi.fn<(message: string) => void>();
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(temporary, { recursive: true, force: true });
});

describe("OpenCode source discovery", () => {
  it("returns no details or warning when OpenCode is absent", async () => {
    expect(await read()).toEqual(new Map());
    expect(await read({ env: {} })).toEqual(new Map());
    expect(warn).not.toHaveBeenCalled();
  });

  it("reads comma-separated roots and removes duplicate roots and message IDs", async () => {
    const second = join(temporary, "second");
    legacy(message());
    legacy(message({ id: "msg-two" }), "msg-two", second);
    legacy(message(), "duplicate", second);
    const result = await read({ env: { OPENCODE_DATA_DIR: ` ${root}, ${second},${root}, ,${root}/../opencode ` } });
    expect(result.get(KEY)).toEqual({
      inputTokens: 200, cachedInputTokens: 80, cacheWriteTokens: 20,
      outputTokens: 40, reasoningTokens: 60, receipts: new Set([ONE, TWO]),
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("uses XDG_DATA_HOME without adding the home default", async () => {
    const xdg = join(temporary, "xdg");
    legacy(message(), "one", join(xdg, "opencode"));
    legacy(message({ id: "msg-two" }), "two", join(temporary, ".local", "share", "opencode"));
    const result = await read({ env: { XDG_DATA_HOME: xdg } });
    expect(result.get(KEY)?.receipts).toEqual(new Set([ONE]));
  });

  it("uses the home default when XDG_DATA_HOME is relative", async () => {
    legacy(message(), "one", join(temporary, ".local", "share", "opencode"));
    const result = await read({ env: { XDG_DATA_HOME: "relative-xdg" } });
    expect(result.get(KEY)?.receipts).toEqual(new Set([ONE]));
  });

  it("does not use defaults for an empty or missing configured root", async () => {
    legacy(message(), "one", join(temporary, ".local", "share", "opencode"));
    expect(await read({ env: { OPENCODE_DATA_DIR: " , " } })).toEqual(new Map());
    expect(await read({ env: { OPENCODE_DATA_DIR: join(temporary, "missing") } })).toEqual(new Map());
    expect(warn).not.toHaveBeenCalled();
  });

  it("reads named channel databases and ignores database sidecars and unrelated names", async () => {
    for (const [name, id] of [["opencode.db", "msg-one"], ["opencode-beta_2.db", "msg-two"]]) {
      const db = database(name);
      messageTable(db);
      insertMessage(db, id);
      db.close();
    }
    writeFileSync(join(root, "other.db"), "unrelated database");
    writeFileSync(join(root, "opencode.beta.db"), "invalid channel name");
    writeFileSync(join(root, "opencode.db-wal"), "not an active WAL");
    const result = await read();
    expect(result.get(KEY)?.receipts).toEqual(new Set([ONE, TWO]));
    expect(result.get(KEY)?.reasoningTokens).toBe(60);
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not follow legacy file links or directory cycles", async () => {
    const path = legacy(message());
    symlinkSync(dirname(path), join(dirname(path), "cycle"));
    symlinkSync(path, join(dirname(path), "linked.json"));
    symlinkSync(path, join(root, "opencode-linked.db"));
    expect((await read()).get(KEY)?.receipts).toEqual(new Set([ONE]));
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("OpenCode counters and receipts", () => {
  it("keeps native output separate from reasoning and returns no prompt fields", async () => {
    legacy(message());
    const result = await read();
    expect(result).toEqual(new Map([[KEY, {
      inputTokens: 100, cachedInputTokens: 40, cacheWriteTokens: 10,
      outputTokens: 20, reasoningTokens: 30, receipts: new Set([ONE]),
    }]]));
    expect(JSON.stringify([...result])).not.toContain("PRIVATE PROMPT SENTINEL");
    expect(warn).not.toHaveBeenCalled();
  });

  it("uses UTC days and filters by the payload time instead of a database timestamp", async () => {
    const db = database();
    messageTable(db);
    insertMessage(db, "msg-one", message({ time: { created: CREATED + 1000 } }), 1);
    insertMessage(db, "msg-two", message(), CREATED + 1000);
    db.close();
    const result = await read({ since: "2026-10-21" });
    expect([...result.keys()]).toEqual([receiptKey("2026-10-21", "opencode", MODEL)]);
    expect([...result.values()][0].receipts).toEqual(new Set([ONE]));
  });

  it("uses SQL IDs for database receipts and keeps the model name ccusage reports", async () => {
    const db = database();
    messageTable(db);
    insertMessage(db, "sql-id", message({ modelID: ` ${MODEL} `, providerID: " anthropic " }));
    db.close();
    const result = await read();
    expect([...result.keys()]).toEqual([KEY]);
    expect(result.get(KEY)?.receipts).toEqual(new Set([SQL_ID]));
  });

  it("gives database records priority over legacy copies and hashes IDs across roots", async () => {
    const db = database();
    messageTable(db);
    insertMessage(db, "msg-one");
    db.close();
    legacy(message({ tokens: { reasoning: 999 } }));
    legacy(message({ tokens: { reasoning: 888 } }), "renamed-copy");
    const second = join(temporary, "second");
    legacy(message({ tokens: { reasoning: 777 } }), "another-copy", second);
    const result = await read({ env: { OPENCODE_DATA_DIR: `${root},${second}` } });
    expect(result.get(KEY)?.reasoningTokens).toBe(30);
    expect(result.get(KEY)?.inputTokens).toBe(100);
    expect(result.get(KEY)?.receipts).toEqual(new Set([ONE]));
  });

  it("retains aggregate counters without inventing a receipt from a filename", async () => {
    legacy(message({ id: undefined }));
    const result = await read();
    expect(result.get(KEY)?.reasoningTokens).toBe(30);
    expect(result.get(KEY)?.receipts).toEqual(new Set());
  });

  it("requires top-level provider and model IDs for legacy messages", async () => {
    legacy(message({ providerID: undefined }), "missing-provider");
    legacy(message({ modelID: undefined, model: { id: MODEL, providerID: "anthropic" } }), "nested-model");
    legacy(message({ modelID: " " }), "empty-model");
    expect(await read()).toEqual(new Map());
    expect(warn).not.toHaveBeenCalled();
  });

  it("matches ccusage's treatment of role fields in legacy records", async () => {
    legacy(message({ role: "user" }));
    expect((await read()).get(KEY)?.reasoningTokens).toBe(30);
  });

  it("keeps reasoning-only records and drops explicit zero-token records", async () => {
    legacy(message({ tokens: { reasoning: 12 } }));
    legacy(message({ id: "msg-two", tokens: { input: 0, output: 0, reasoning: 0, total: 0 }, cost: 1 }), "two");
    const result = await read();
    expect(result.get(KEY)?.reasoningTokens).toBe(12);
    expect(result.get(KEY)?.outputTokens).toBe(0);
    expect(result.get(KEY)?.receipts).toEqual(new Set([ONE]));
  });

  it("matches ccusage's total-only fallback without counting reasoning twice", async () => {
    legacy(message({ tokens: { input: 10, reasoning: 20, total: 100 } }));
    const result = await read();
    expect(result.get(KEY)?.outputTokens).toBe(70);
    expect(result.get(KEY)?.reasoningTokens).toBe(20);
  });

  it("treats unsupported counter types as zero, as ccusage does", async () => {
    legacy(message({ tokens: { input: "100", output: -5, reasoning: 12, cache: { read: 1.5, write: null } } }));
    const result = await read();
    expect(result.get(KEY)).toEqual({ inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0,
      outputTokens: 0, reasoningTokens: 12, receipts: new Set([ONE]) });
  });

  it("uses the epoch for absent legacy timestamps and supports schemas without time_created", async () => {
    const db = database();
    messageTable(db, false);
    db.prepare("INSERT INTO message VALUES (?, ?, ?)").run("msg-one", "session-one", JSON.stringify(message({ time: undefined })));
    db.close();
    expect([...((await read()).keys())]).toEqual([receiptKey("1970-01-01", "opencode", MODEL)]);
    expect(await read({ since: DAY })).toEqual(new Map());
  });
});

describe("OpenCode v2 database messages", () => {
  it("reads only assistant rows, prefers nested model IDs, and falls back to the column time", async () => {
    const db = database();
    v2Table(db);
    const insert = db.prepare("INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)");
    const payload = message({ model: { id: MODEL, modelID: "ignored-model", providerID: "anthropic" }, modelID: "ignored-top-model", time: {} });
    insert.run("msg-one", "session-one", "assistant", JSON.stringify(payload), 1, CREATED);
    insert.run("msg-two", "session-one", "user", JSON.stringify(message()), 2, CREATED);
    db.close();
    const result = await read();
    expect([...result.keys()]).toEqual([KEY]);
    expect(result.get(KEY)?.receipts).toEqual(new Set([ONE]));
    expect(result.get(KEY)?.outputTokens).toBe(20);
  });

  it("supports nested modelID and a schema without time_created", async () => {
    const db = database();
    v2Table(db, false);
    db.prepare("INSERT INTO session_message VALUES (?, ?, ?, ?, ?)").run("msg-one", "session-one", "assistant",
      JSON.stringify(message({ model: { modelID: MODEL, providerID: "anthropic" }, modelID: undefined, providerID: undefined })), 1);
    db.close();
    expect((await read()).get(KEY)?.receipts).toEqual(new Set([ONE]));
    expect(warn).not.toHaveBeenCalled();
  });

  it("deduplicates message IDs shared by both database tables", async () => {
    const db = database();
    messageTable(db);
    v2Table(db);
    insertMessage(db, "msg-one");
    db.prepare("INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)").run("msg-one", "session-one", "assistant",
      JSON.stringify(message({ tokens: { reasoning: 999 } })), 1, CREATED);
    db.close();
    expect((await read()).get(KEY)?.reasoningTokens).toBe(30);
  });

  it.each(["before", "through"])("excludes inherited %s fork rows with distinct message IDs", async (type) => {
    const db = database();
    v2Table(db);
    db.exec("CREATE TABLE session_v2 (id TEXT PRIMARY KEY, fork_session_id TEXT, fork_boundary TEXT)");
    const insert = db.prepare("INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)");
    insert.run("msg-one", "parent", "assistant", JSON.stringify(message()), 10, CREATED);
    insert.run("boundary", "parent", "user", "{}", 30, CREATED);
    insert.run("copied-parent", "fork", "assistant", JSON.stringify(message()), 10, CREATED);
    if (type === "through") insert.run("copied-boundary", "fork", "assistant", JSON.stringify(message()), 30, CREATED);
    insert.run("msg-two", "fork", "assistant", JSON.stringify(message()), type === "before" ? 11 : 31, CREATED);
    db.prepare("INSERT INTO session_v2 VALUES (?, ?, ?)").run("fork", "parent", JSON.stringify({ type, messageID: "boundary" }));
    db.close();
    const result = await read();
    expect(result.get(KEY)?.reasoningTokens).toBe(60);
    expect(result.get(KEY)?.receipts).toEqual(new Set([ONE, TWO]));
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not treat cumulative session counters as daily message usage", async () => {
    const db = database();
    v2Table(db);
    db.exec("CREATE TABLE session_v2 (id TEXT, tokens_reasoning INTEGER)");
    db.exec("INSERT INTO session_v2 VALUES ('no-messages', 999)");
    db.close();
    expect(await read()).toEqual(new Map());
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("OpenCode read limits and errors", () => {
  it("reads more than one database page and leaves a database unchanged", async () => {
    const db = database();
    messageTable(db);
    db.exec("BEGIN");
    for (let i = 0; i < 193; i++) insertMessage(db, `msg-${i}`);
    db.exec("COMMIT");
    db.close();
    const before = readFileSync(join(root, "opencode.db"));
    const result = await read();
    expect(result.get(KEY)?.reasoningTokens).toBe(193 * 30);
    expect(result.get(KEY)?.receipts.size).toBe(193);
    expect(readFileSync(join(root, "opencode.db"))).toEqual(before);
  });

  it("reads committed WAL records while another database connection remains open", async () => {
    const db = database();
    try {
      db.exec("PRAGMA journal_mode = WAL");
      messageTable(db);
      insertMessage(db, "msg-one");
      expect((await read()).get(KEY)?.reasoningTokens).toBe(30);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it.each(["corrupt database", "unknown schema", "missing columns", "missing v2 type"])(
    "warns and withholds all details for a %s", async (failure) => {
      legacy(message());
      if (failure === "corrupt database") writeFileSync(join(root, "opencode.db"), "PRIVATE PROMPT SENTINEL");
      else {
        const db = database();
        if (failure === "unknown schema") db.exec("CREATE TABLE unrelated (data TEXT)");
        if (failure === "missing columns") db.exec("CREATE TABLE message (id TEXT, data TEXT)");
        if (failure === "missing v2 type") db.exec("CREATE TABLE session_message (id TEXT, session_id TEXT, data TEXT)");
        db.close();
      }
      expect(await read()).toEqual(new Map());
      expect(warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(JSON.stringify(realpathSync(join(root, "opencode.db")))));
      expect(JSON.stringify(warn.mock.calls)).not.toContain("PRIVATE PROMPT SENTINEL");
    },
  );

  it("warns on an unreadable root instead of treating it as an absent installation", async () => {
    writeFileSync(root, "not a directory");
    expect(await read()).toEqual(new Map());
    expect(warn).toHaveBeenCalledOnce();
  });

  it("warns and withholds valid rows when another legacy message is incomplete", async () => {
    const path = legacy(message());
    writeFileSync(join(dirname(path), "truncated.json"), '{"tokens":');
    const scan = await readOpenCodeDetails({ env: { OPENCODE_DATA_DIR: root }, home: temporary, warn });
    expect(scan.details).toEqual(new Map());
    expect(scan.incompleteSources).toEqual([realpathSync(join(dirname(path), "truncated.json"))]);
    expect(warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("truncated.json"));
    expect(warn.mock.calls[0][0]).not.toContain("retry");
  });

  it.each(["legacy", "database"])("limits a single %s message read", async (kind) => {
    const payload = message({ content: "x".repeat(8 * 1024 * 1024) });
    if (kind === "legacy") legacy(payload);
    else {
      const db = database();
      messageTable(db);
      insertMessage(db, "msg-one", payload);
      db.close();
    }
    expect(await read()).toEqual(new Map());
    expect(warn).toHaveBeenCalledOnce();
  });

  it("withholds counters when total contains output that cannot be classified as reasoning", async () => {
    legacy(message({ tokens: { input: 10, output: 20, reasoning: 30, total: 100 } }));
    expect(await read()).toEqual(new Map());
    expect(warn).toHaveBeenCalledOnce();
  });

  it("uses console.warn when no warning callback is supplied", async () => {
    const path = legacy(message());
    writeFileSync(path, "{");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await read({ warn: undefined })).toEqual(new Map());
    expect(warning).toHaveBeenCalledOnce();
  });

  it("propagates cancellation before a scan without a warning", async () => {
    const controller = new AbortController();
    const reason = new Error("test cancellation");
    controller.abort(reason);
    await expect(read({ signal: controller.signal })).rejects.toBe(reason);
    expect(warn).not.toHaveBeenCalled();
  });

  it("propagates cancellation after a scan starts without a warning", async () => {
    const db = database();
    messageTable(db);
    for (let i = 0; i < 193; i++) insertMessage(db, `msg-${i}`);
    db.close();
    const controller = new AbortController();
    const pending = read({ signal: controller.signal });
    const cancellation = setImmediate(() => controller.abort());
    try {
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      clearImmediate(cancellation);
    }
  });

  it.each(["bad-date", "2026-02-30"])("rejects invalid day %s", async (since) => {
    await expect(read({ since })).rejects.toThrow("OpenCode since must be a UTC day");
  });
});
