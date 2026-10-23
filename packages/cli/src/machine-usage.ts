import { homedir } from "node:os";
import { readUsageAggregates, type CcusageOptions, type UsageAggregate } from "./ccusage.js";
import { readCursorUsage } from "./cursor.js";
import { readOpenCodeDetails } from "./opencode.js";
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
  const details = base.some((row) => row.provider === "opencode")
    ? await (options.readOpenCode ?? readOpenCodeDetails)(sourceOptions) : new Map();
  const aggregates: UsageAggregate[] = [];
  for (const row of base) {
    if (row.provider !== "opencode") {
      aggregates.push(row);
      continue;
    }
    const key = receiptKey(row.day, row.provider, row.model);
    const detail = details.get(key);
    if (!detail || detail.inputTokens !== row.inputTokens || detail.cachedInputTokens !== row.cachedInputTokens ||
      detail.cacheWriteTokens !== row.cacheWriteTokens || detail.outputTokens !== row.outputTokens) {
      // Never replace a complete stored day with a snapshot that omits known reasoning usage.
      options.warn?.(`OpenCode details do not match the usage report for ${row.day} ${row.model}. This row was not uploaded; retry sync.`);
      continue;
    }
    aggregates.push({ ...row, reasoningTokens: detail.reasoningTokens });
    receipts.set(key, detail.receipts);
  }
  const cursor = await (options.readCursor ?? readCursorUsage)(sourceOptions);
  signal.throwIfAborted();
  aggregates.push(...cursor.aggregates);
  for (const [key, hashes] of cursor.receipts) receipts.set(key, hashes);
  return { aggregates, receipts };
}
