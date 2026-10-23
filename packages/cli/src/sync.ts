/*
  `tokenburnmarket sync`: read this machine's Usage, sign it, upload it.

  Nothing leaves the machine except token counts, cost, and the hashes of
  message identifiers. No prompts, no file names, no project paths.
*/
import { homedir } from "node:os";
import {
  checkPlausibility,
  createSignedSync,
  inSyncWindow,
  MAX_SYNC_DAYS,
  nextSyncSlot,
  SYNC_JITTER_MS,
  SYNC_TRIGGER_HEADER,
  syncSlotStart,
  SyncPayloadSchema,
} from "@tokenburnmarket/core";
import type { SyncDay, SyncPayload, SyncTrigger, TrustLevel } from "@tokenburnmarket/core";
import { readUsageAggregates } from "./ccusage.js";
import { buildSyncDays, shiftDay, utcDay, windowStart } from "./collect.js";
import { currentConfigPath, readConfig, writeConfig } from "./config.js";
import { readReceiptStreams } from "./receipts.js";
import { acquireSyncLock } from "./sync-lock.js";
import { usageEnvironment } from "./usage-environment.js";
import { readMachineUsage } from "./machine-usage.js";

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
  signal?: AbortSignal;
  /** `--since N`: collect the last N days instead of the days since the watermark. */
  sinceDays?: number;
  reviewHistory?: boolean;
  dryRun?: boolean;
  /**
   * A sync nobody asked for, from the MCP server or the daemon. It only runs
   * inside a Sync Slot window and once per slot (ADR 0005): the server refuses
   * automatic syncs outside the windows, and several agents waking at the same
   * slot should not read the same transcripts twice.
   */
  scheduled?: boolean;
  /** The total line only, no per-day table. For when the sync is a step in something else. */
  brief?: boolean;
  /** Page boundary in JSON bytes. Tests lower it; nothing else should. */
  maxPayloadBytes?: number;
  log?: (line: string) => void;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
  home?: string;
  /** Injected in tests. Defaults spawn ccusage and talk to the real server. */
  readUsage?: typeof readUsageAggregates;
  collectUsage?: typeof readMachineUsage;
  fetch?: typeof fetch;
}

/*
  The server runs on Vercel, which refuses a function request body over 4.5 MB.
  A first sync from a machine with years of transcripts is many times that, so
  the days go up in pages, oldest first, each under this budget. Oldest first
  because the server moves the watermark forward after every page, and a later
  page that reached back behind it would come back Quarantined.
*/
export const MAX_PAYLOAD_BYTES = 3_500_000;

/**
 * Rows cut into pages that stay under both the transport budget and the API's
 * row limit. Rows remain in ascending day order, so advancing the watermark
 * after one page never makes a later page stale.
 */
export function pageDays(
  days: readonly SyncDay[],
  maxBytes: number,
  maxRows = MAX_SYNC_DAYS,
): SyncDay[][] {
  const pages: SyncDay[][] = [];
  let page: SyncDay[] = [];
  let bytes = 0;
  for (const day of days) {
    const size = JSON.stringify(day).length + 1;
    if (page.length > 0 && (bytes + size > maxBytes || page.length >= maxRows)) {
      pages.push(page);
      page = [];
      bytes = 0;
    }
    page.push(day);
    bytes += size;
  }
  if (page.length > 0) pages.push(page);
  return pages;
}

/** "2 minutes ago", for the one line a skipped sync prints. */
function agoLine(then: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - then) / 60_000));
  if (minutes < 1) return "under a minute ago";
  return minutes === 1 ? "a minute ago" : `${minutes} minutes ago`;
}

const money = (usd: number) =>
  `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
  trigger: SyncTrigger,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<SyncResponse> {
  const signed = await createSignedSync(privateKey, payload);
  const response = await fetchImpl(`${serverUrl}/api/sync`, {
    method: "POST",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${deviceToken}`,
      [SYNC_TRIGGER_HEADER]: trigger,
    },
    body: JSON.stringify(signed),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Sync was refused with ${response.status}. ${detail.slice(0, 200)}`.trim());
  }
  return (await response.json()) as SyncResponse;
}

/**
 * How long a Collector waits for its next automatic sync: to the next slot
 * boundary, plus a random spread inside the window so a slot is not one spike.
 */
export function msUntilScheduledSync(now: Date, random: () => number = Math.random): number {
  return nextSyncSlot(now).getTime() - now.getTime() + Math.floor(random() * SYNC_JITTER_MS);
}

export async function sync(options: SyncOptions = {}): Promise<number> {
  const configPath = options.configPath ?? currentConfigPath();
  const lock = acquireSyncLock(`${configPath}.sync-lock`);
  if (!lock) {
    (options.log ?? console.log)("Another usage sync is already running. Skipping this sync.");
    return 0;
  }
  try {
    options.signal?.throwIfAborted();
    return await syncLocked({ ...options, configPath });
  } finally {
    lock.release();
  }
}

async function syncLocked(options: SyncOptions): Promise<number> {
  const log = options.log ?? ((line: string) => console.log(line));
  const now = (options.now ?? (() => new Date()))();
  const home = options.home ?? homedir();
  const env = usageEnvironment(options.env ?? process.env, home);
  const configPath = options.configPath ?? currentConfigPath();
  const fetchImpl = options.fetch ?? fetch;

  const config = readConfig(configPath);
  if (!config) {
    log("Not connected. Run: tokenburnmarket connect");
    return 1;
  }

  if (options.reviewHistory && (options.scheduled || options.sinceDays === undefined)) {
    log("History review requires a manual sync with --since N.");
    return 1;
  }

  if (options.scheduled && !options.dryRun) {
    if (!inSyncWindow(now)) {
      log(`Outside a sync slot. The next one is ${nextSyncSlot(now).toISOString().slice(11, 16)} UTC.`);
      return 0;
    }
    const last = config.lastSyncedAt ? Date.parse(config.lastSyncedAt) : Number.NaN;
    if (Number.isFinite(last) && last >= syncSlotStart(now).getTime()) {
      log(`Synced ${agoLine(last, now.getTime())}. Nothing to do yet.`);
      return 0;
    }
  }

  const start = windowStart({
    now,
    watermarkDay: config.lastSyncedDay,
    sinceDays: options.sinceDays,
    reviewHistory: options.reviewHistory,
  });

  if (
    options.sinceDays !== undefined &&
    start !== undefined &&
    start > shiftDay(utcDay(now), -Math.max(0, options.sinceDays))
  ) {
    log(`The server's backfill limit starts at ${start}. Older missing or corrected usage requires review.`);
  }
  log(
    start
      ? `Reading usage since ${start}.`
      : "Reading all usage on this machine. This takes a moment the first time.",
  );
  if (options.reviewHistory) {
    log("Older rows will be replaced and quarantined for admin review. They will not count until approved.");
  }
  const sourceOptions = { since: start, env, home, signal: options.signal, warn: log };
  const collected = options.readUsage ? await options.readUsage(sourceOptions) : null;
  options.signal?.throwIfAborted();
  const { aggregates, receipts } = collected !== null
    ? { aggregates: collected, receipts: readReceiptStreams(env, home, start) }
    : await (options.collectUsage ?? readMachineUsage)(sourceOptions);
  options.signal?.throwIfAborted();
  const days = buildSyncDays(aggregates, receipts, { now, start });

  if (days.length === 0) {
    log("Nothing to sync.");
    return 0;
  }

  // Budget less the envelope around the days, which is small and fixed.
  const historyOption = options.reviewHistory ? { reviewHistory: true as const } : {};
  const envelope = JSON.stringify({ version: 1, deviceId: config.deviceId, sentAt: now.toISOString(), ...historyOption, days: [] }).length;
  const pages = pageDays(days, (options.maxPayloadBytes ?? MAX_PAYLOAD_BYTES) - envelope);

  const payloads: SyncPayload[] = [];
  for (const pageDaysList of pages) {
    // sentAt is read per page: the server checks clock skew on each, and a
    // long first sync can outlive the window a single timestamp would get.
    const payload: SyncPayload = {
      version: 1,
      ...historyOption,
      deviceId: config.deviceId,
      sentAt: (options.now ?? (() => new Date()))().toISOString(),
      days: pageDaysList,
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
    payloads.push(parsed.data);
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

  if (payloads.length > 1) log(`Uploading in ${payloads.length} parts.`);

  // Each page is its own Sync as far as the server is concerned. The watermark
  // is saved after every one, so a page that fails leaves the earlier pages
  // counted and the next run resuming from where this one stopped.
  const outcomes: DayOutcome[] = [];
  let watermark = config.lastSyncedDay ?? null;
  for (const payload of payloads) {
    options.signal?.throwIfAborted();
    const result = await upload(
      config.serverUrl,
      config.deviceToken,
      payload,
      config.privateKey,
      options.scheduled ? "scheduled" : "manual",
      fetchImpl,
      options.signal,
    );
    outcomes.push(...result.days);
    watermark = result.nextWatermark ?? watermark;
    writeConfig({ ...config, lastSyncedDay: watermark, lastSyncedAt: now.toISOString() }, configPath);
  }

  if (!options.brief) {
    log("");
    for (const line of formatSummary(outcomes, costs)) log(line);
  }

  const quarantined = outcomes.filter((day) => day.trustLevel === "quarantined");
  if (quarantined.length > 0) {
    log("");
    log("Quarantined, visible only to you until reviewed:");
    for (const day of quarantined) {
      for (const reason of day.reasons) log(`  ${day.day} ${day.provider}  ${reason.message}`);
    }
  }

  const total = days.reduce((sum, day) => sum + day.costUsd, 0);
  if (!options.brief) log("");
  log(`${outcomes.length} rows, ${money(total)}, ${receiptTotal} receipts. @${config.handle}`);
  return 0;
}
