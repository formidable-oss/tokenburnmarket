/*
  `tokenburnmarket sync`: read this machine's Usage, sign it, upload it.

  Nothing leaves the machine except token counts, cost, and the hashes of
  message identifiers. No prompts, no file names, no project paths.
*/
import { homedir } from "node:os";
import { checkPlausibility, createSignedSync, SyncPayloadSchema } from "@tokenburnmarket/core";
import type { SyncDay, SyncPayload, TrustLevel } from "@tokenburnmarket/core";
import { readUsageAggregates } from "./ccusage.js";
import { buildSyncDays, windowStart } from "./collect.js";
import { currentConfigPath, readConfig, writeConfig } from "./config.js";
import { readReceiptStreams } from "./receipts.js";

/** One row of the server's answer, or of the local preview a dry run prints. */
interface DayOutcome {
  day: string;
  provider: string;
  model: string;
  trustLevel: TrustLevel;
  reasons: { code: string; message: string }[];
}

interface SyncResponse {
  days: DayOutcome[];
  nextWatermark: string | null;
}

export interface SyncOptions {
  configPath?: string;
  /** `--since N`: collect the last N days instead of the days since the watermark. */
  sinceDays?: number;
  dryRun?: boolean;
  log?: (line: string) => void;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

const money = (usd: number) => `$${usd.toFixed(2)}`;

/** A dense, aligned table. Numbers are right aligned; nothing is truncated silently. */
export function formatSummary(rows: readonly DayOutcome[], costs: Map<string, number>): string[] {
  const header = ["day", "provider", "model", "cost", "trust"];
  const body = rows.map((row) => [
    row.day,
    row.provider,
    row.model,
    money(costs.get(`${row.day} ${row.provider} ${row.model}`) ?? 0),
    row.trustLevel,
  ]);
  const widths = header.map((_, column) =>
    Math.max(header[column]!.length, ...body.map((cells) => cells[column]!.length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, column) => (column === 3 ? cell.padStart(widths[column]!) : cell.padEnd(widths[column]!)))
      .join("  ")
      .trimEnd();

  return [line(header), ...body.map(line)];
}

/** What the server will decide, computed locally so `--dry-run` is worth running. */
function preview(days: readonly SyncDay[], now: Date, watermarkDay?: string): DayOutcome[] {
  return days.map((day) => {
    const result = checkPlausibility(
      {
        day: day.day,
        provider: day.provider,
        model: day.model,
        inputTokens: day.inputTokens,
        cachedInputTokens: day.cachedInputTokens,
        cacheWriteTokens: day.cacheWriteTokens,
        outputTokens: day.outputTokens,
        reasoningTokens: day.reasoningTokens,
        costUsd: day.costUsd,
        receiptCount: day.receipts.length,
      },
      { now, deviceWatermarkDay: watermarkDay },
    );
    return {
      day: day.day,
      provider: day.provider,
      model: day.model,
      trustLevel: result.trustLevel,
      reasons: result.reasons,
    };
  });
}

async function upload(
  serverUrl: string,
  deviceToken: string,
  payload: SyncPayload,
  privateKey: string,
): Promise<SyncResponse> {
  const signed = await createSignedSync(privateKey, payload);
  const response = await fetch(`${serverUrl}/api/sync`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${deviceToken}`,
    },
    body: JSON.stringify(signed),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Sync was refused with ${response.status}. ${detail.slice(0, 200)}`.trim());
  }
  return (await response.json()) as SyncResponse;
}

export async function sync(options: SyncOptions = {}): Promise<number> {
  const log = options.log ?? ((line: string) => console.log(line));
  const now = (options.now ?? (() => new Date()))();
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const configPath = options.configPath ?? currentConfigPath();

  const config = readConfig(configPath);
  if (!config) {
    log("Not connected. Run: tokenburnmarket connect");
    return 1;
  }

  const start = windowStart({
    now,
    watermarkDay: config.lastSyncedDay,
    sinceDays: options.sinceDays,
  });

  log(start ? `Reading usage since ${start}.` : "Reading all usage on this machine.");
  const aggregates = await readUsageAggregates({ since: start, env });
  const receipts = readReceiptStreams(env, home, start);
  const days = buildSyncDays(aggregates, receipts, { now, start });

  if (days.length === 0) {
    log("Nothing to sync.");
    return 0;
  }

  const payload: SyncPayload = {
    version: 1,
    deviceId: config.deviceId,
    sentAt: now.toISOString(),
    days,
  };
  const parsed = SyncPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    // A payload this Collector cannot even describe would be rejected anyway,
    // and the local message says which field went wrong.
    log("This machine produced usage the server would reject:");
    for (const issue of parsed.error.issues.slice(0, 5)) {
      log(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    return 1;
  }

  const costs = new Map(days.map((day) => [`${day.day} ${day.provider} ${day.model}`, day.costUsd]));
  const receiptTotal = days.reduce((sum, day) => sum + day.receipts.length, 0);

  if (options.dryRun) {
    log("");
    for (const line of formatSummary(preview(days, now, config.lastSyncedDay ?? undefined), costs)) {
      log(line);
    }
    log("");
    log(`${days.length} rows, ${receiptTotal} receipts. Nothing was uploaded.`);
    return 0;
  }

  const result = await upload(config.serverUrl, config.deviceToken, parsed.data, config.privateKey);

  log("");
  for (const line of formatSummary(result.days, costs)) log(line);

  const quarantined = result.days.filter((day) => day.trustLevel === "quarantined");
  if (quarantined.length > 0) {
    log("");
    log("Quarantined, visible only to you until reviewed:");
    for (const day of quarantined) {
      for (const reason of day.reasons) log(`  ${day.day} ${day.provider}  ${reason.message}`);
    }
  }

  writeConfig({ ...config, lastSyncedDay: result.nextWatermark ?? config.lastSyncedDay }, configPath);

  const total = days.reduce((sum, day) => sum + day.costUsd, 0);
  log("");
  log(`${result.days.length} rows, ${money(total)}, ${receiptTotal} receipts. @${config.handle}`);
  return 0;
}
