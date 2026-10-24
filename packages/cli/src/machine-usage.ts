import { homedir } from "node:os";
import { readUsageAggregates, type CcusageOptions, type UsageAggregate } from "./ccusage.js";
import { readCursorUsage } from "./cursor.js";
import { readOpenCodeDetails, type OpenCodeReadResult } from "./opencode.js";
import { readReceiptStreams, receiptKey, type ReceiptIndex } from "./receipts.js";
import { usageEnvironment } from "./usage-environment.js";

export interface MachineUsage {
  aggregates: UsageAggregate[];
  receipts: ReceiptIndex;
}

export interface MachineUsageOptions extends CcusageOptions {
  readBase?: typeof readUsageAggregates;
  readCursor?: typeof readCursorUsage;
  readOpenCode?: typeof readOpenCodeDetails;
  readReceipts?: typeof readReceiptStreams;
}

export async function readMachineUsage(options: MachineUsageOptions = {}): Promise<MachineUsage> {
  const home = options.home ?? homedir();
  const env = usageEnvironment(options.env ?? process.env, home);
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(5 * 60_000)]);
  const sourceOptions = { ...options, home, env, signal };
  const base = await (options.readBase ?? readUsageAggregates)(sourceOptions);
  signal.throwIfAborted();
  const receipts = (options.readReceipts ?? readReceiptStreams)(env, home, options.since);
  // The single warning below names the reader's incomplete sources.
  const details = base.some((row) => row.provider === "opencode")
    ? await (options.readOpenCode ?? readOpenCodeDetails)({ ...sourceOptions, warn: () => {} })
    : { details: new Map(), incompleteSources: [], incompleteSourceCount: 0 };
  const aggregates: UsageAggregate[] = [];
  const fallbackDays = new Set<string>();
  let changed = false;
  for (const row of base) {
    if (row.provider !== "opencode") {
      aggregates.push(row);
      continue;
    }
    const key = receiptKey(row.day, row.provider, row.model);
    const detail = details.details.get(key);
    const matches = detail !== undefined && detail.inputTokens === row.inputTokens &&
      detail.cachedInputTokens === row.cachedInputTokens && detail.cacheWriteTokens === row.cacheWriteTokens &&
      detail.outputTokens === row.outputTokens;
    if (!detail || !matches) {
      // Without matching details, fill only missing rows so a complete stored day is never
      // replaced by totals that omit reasoning or receipts.
      if (detail) changed = true;
      fallbackDays.add(row.day);
      aggregates.push({ ...row, onlyIfMissing: true });
      receipts.delete(key);
      continue;
    }
    aggregates.push({ ...row, reasoningTokens: detail.reasoningTokens });
    receipts.set(key, detail.receipts);
  }
  if (fallbackDays.size > 0) options.warn?.(openCodeFallbackWarning([...fallbackDays].sort(), details, changed));
  const cursor = await (options.readCursor ?? readCursorUsage)(sourceOptions);
  signal.throwIfAborted();
  aggregates.push(...cursor.aggregates);
  for (const [key, hashes] of cursor.receipts) receipts.set(key, hashes);
  return { aggregates, receipts };
}

function openCodeFallbackWarning(days: string[], read: OpenCodeReadResult, changed: boolean): string {
  const span = days.length === 1 ? days[0] : `${days.length} days from ${days[0]} to ${days.at(-1)}`;
  const reasons: string[] = [];
  if (read.incompleteSourceCount > 0) {
    const more = read.incompleteSourceCount - read.incompleteSources.length;
    reasons.push(`Check these sources for unreadable data or unsupported records: ${read.incompleteSources.map((path) => JSON.stringify(path)).join(", ")}${more > 0 ? ` and ${more} more` : ""}.`);
  }
  if (changed) reasons.push("OpenCode usage changed during the scan. The next sync retries.");
  return [`OpenCode details are unavailable for ${span}. Using ccusage totals without receipts for missing rows only; stored usage is preserved.`, ...reasons].join(" ");
}
