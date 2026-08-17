/*
  Receipt Streams (ADR 0003): the hashes of per-message identifiers behind a
  day's Usage. Never content, never anything reversible into a prompt.

  Claude Code writes one JSONL per session under `projects/`; every assistant
  message carries `message.id` and `requestId`, and the pair identifies one call
  to the API. Codex writes rollout files under `sessions/`; each `token_count`
  event is one billed turn, identified by its session, its position in that
  session and its timestamp.

  Two machines reading the same transcripts produce the same hashes, which is
  the whole point: the server can then tell one day of work from two.
*/
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Streams keyed by (day, provider, model). Values are unique hashes. */
export type ReceiptIndex = Map<string, Set<string>>;

export function receiptKey(day: string, provider: string, model: string): string {
  return `${day} ${provider} ${model}`;
}

function add(index: ReceiptIndex, day: string, provider: string, model: string, hash: string): void {
  const key = receiptKey(day, provider, model);
  const existing = index.get(key);
  if (existing) existing.add(hash);
  else index.set(key, new Set([hash]));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** UTC calendar day of an ISO timestamp, or null when it is not a timestamp. */
function utcDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Every `.jsonl` under `dir`, skipping files untouched since `sinceDay`.
 *
 * The mtime filter is what makes a Sync cheap: a year of transcripts is
 * gigabytes, and a file last written before the window cannot hold a day inside
 * it. One day of slack absorbs clock skew and timezone edges.
 */
function transcriptFiles(dir: string, sinceDay?: string): string[] {
  let entries: { name: string; parentPath: string; isFile: () => boolean }[];
  try {
    entries = readdirSync(dir, { recursive: true, withFileTypes: true });
  } catch {
    return [];
  }

  const floor = sinceDay ? Date.parse(`${sinceDay}T00:00:00.000Z`) - 86_400_000 : undefined;
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const path = join(entry.parentPath, entry.name);
    if (floor !== undefined) {
      try {
        if (statSync(path).mtimeMs < floor) continue;
      } catch {
        continue;
      }
    }
    files.push(path);
  }
  return files.sort();
}

function readLines(path: string): string[] {
  try {
    return readFileSync(path, "utf8").split("\n");
  } catch {
    return [];
  }
}

/** Config roots for Claude Code. CLAUDE_CONFIG_DIR wins and may list several, comma separated. */
export function claudeRoots(env: NodeJS.ProcessEnv, home: string): string[] {
  const configured = env.CLAUDE_CONFIG_DIR?.trim();
  if (configured) {
    return configured
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }
  return [join(home, ".claude"), join(home, ".config", "claude")];
}

/** Config root for Codex. CODEX_HOME wins, as the Codex CLI itself defines it. */
export function codexRoots(env: NodeJS.ProcessEnv, home: string): string[] {
  const configured = env.CODEX_HOME?.trim();
  return configured ? [configured] : [join(home, ".codex")];
}

/**
 * Claude Code: sha256(`message.id:requestId`) per assistant message.
 *
 * Lines without both identifiers are skipped. Resumed and compacted sessions
 * repeat messages across files, so the same hash arriving twice is expected and
 * the set collapses it.
 */
export function readClaudeStreams(roots: readonly string[], sinceDay?: string): ReceiptIndex {
  const index: ReceiptIndex = new Map();

  for (const root of roots) {
    for (const file of transcriptFiles(join(root, "projects"), sinceDay)) {
      for (const line of readLines(file)) {
        if (line.length === 0 || !line.includes('"assistant"')) continue;

        let entry: unknown;
        try {
          entry = JSON.parse(line);
        } catch {
          continue; // A half-written last line is normal while an agent is running.
        }
        if (!isRecord(entry) || entry.type !== "assistant" || !isRecord(entry.message)) continue;

        const messageId = entry.message.id;
        const requestId = entry.requestId;
        if (typeof messageId !== "string" || typeof requestId !== "string") continue;

        const day = utcDay(entry.timestamp);
        const model = typeof entry.message.model === "string" ? entry.message.model : "";
        if (!day || !model) continue;
        if (sinceDay && day < sinceDay) continue;

        add(index, day, "claude", model, sha256(`${messageId}:${requestId}`));
      }
    }
  }

  return index;
}

/**
 * Codex: sha256(`session_id:ordinal:timestamp`) per `token_count` event.
 *
 * The ordinal is the event's position in its session file, counted from zero.
 * Rollout files are append only, so the same event keeps the same ordinal on
 * every run and on every machine that reads the file.
 */
export function readCodexStreams(roots: readonly string[], sinceDay?: string): ReceiptIndex {
  const index: ReceiptIndex = new Map();

  for (const root of roots) {
    for (const file of transcriptFiles(join(root, "sessions"), sinceDay)) {
      let sessionId = "";
      let model = "";
      let ordinal = 0;

      for (const line of readLines(file)) {
        if (line.length === 0) continue;
        let entry: unknown;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        if (!isRecord(entry) || !isRecord(entry.payload)) continue;
        const payload = entry.payload;

        if (entry.type === "session_meta") {
          const id = payload.session_id ?? payload.id;
          if (typeof id === "string") sessionId = id;
          if (typeof payload.model === "string") model = payload.model;
          continue;
        }
        if (entry.type === "turn_context") {
          if (typeof payload.model === "string") model = payload.model;
          continue;
        }
        if (payload.type !== "token_count") continue;

        const position = ordinal;
        ordinal += 1;
        if (!sessionId || !model) continue;

        const day = utcDay(entry.timestamp);
        if (!day) continue;
        if (sinceDay && day < sinceDay) continue;

        add(index, day, "codex", model, sha256(`${sessionId}:${position}:${entry.timestamp}`));
      }
    }
  }

  return index;
}

/** Both adapters, merged. Any other agent ccusage reports arrives without a stream, so Reported. */
export function readReceiptStreams(
  env: NodeJS.ProcessEnv,
  home: string,
  sinceDay?: string,
): ReceiptIndex {
  const index = readClaudeStreams(claudeRoots(env, home), sinceDay);
  for (const [key, hashes] of readCodexStreams(codexRoots(env, home), sinceDay)) {
    const existing = index.get(key);
    if (existing) for (const hash of hashes) existing.add(hash);
    else index.set(key, hashes);
  }
  return index;
}
