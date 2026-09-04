/*
  ccusage reports plus Receipt Streams to the days a Sync uploads. The JSON here
  is trimmed from real `ccusage --json` output, field names untouched.
*/
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkPlausibility } from "@tokenburnmarket/core";
import { ccusageCommand, parseCodexReasoning, parseUnifiedDaily, readUsageAggregates } from "./ccusage.js";
import { buildSyncDays, shiftDay, windowStart } from "./collect.js";
import { readReceiptStreams } from "./receipts.js";

const fixture = (name: string) =>
  fileURLToPath(new URL(`../test/fixtures/${name}`, import.meta.url));

const UNIFIED = {
  daily: [
    {
      date: "2026-08-16",
      agents: [
        {
          agent: "claude",
          modelBreakdowns: [
            {
              modelName: "claude-opus-5",
              inputTokens: 30,
              cacheReadTokens: 2_546_320,
              cacheCreationTokens: 221_878,
              outputTokens: 620,
              cost: 7.7577125,
            },
          ],
        },
        {
          agent: "codex",
          modelBreakdowns: [
            {
              modelName: "gpt-5.6-sol",
              inputTokens: 4600,
              cacheReadTokens: 3200,
              cacheCreationTokens: 0,
              outputTokens: 400,
              cost: 0.0412,
            },
          ],
        },
      ],
    },
    {
      date: "2026-08-17",
      agents: [
        {
          agent: "claude",
          modelBreakdowns: [
            {
              modelName: "claude-haiku-4-5",
              inputTokens: 4,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
              outputTokens: 40,
              cost: 0.0031,
            },
          ],
        },
        {
          agent: "gemini",
          modelBreakdowns: [
            {
              modelName: "gemini-3-pro",
              inputTokens: 1200,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
              outputTokens: 90,
              cost: 0.21,
            },
          ],
        },
      ],
    },
  ],
};

const CODEX = {
  daily: [
    {
      date: "2026-08-16",
      costUSD: 0.0412,
      models: {
        "gpt-5.6-sol": {
          inputTokens: 4600,
          cacheReadTokens: 3200,
          outputTokens: 400,
          reasoningOutputTokens: 200,
        },
      },
    },
  ],
};

describe("parseUnifiedDaily", () => {
  it("flattens agents and models into one row each", () => {
    expect(parseUnifiedDaily(UNIFIED)).toEqual([
      {
        day: "2026-08-16",
        provider: "claude",
        model: "claude-opus-5",
        inputTokens: 30,
        cachedInputTokens: 2_546_320,
        cacheWriteTokens: 221_878,
        outputTokens: 620,
        reasoningTokens: 0,
        costUsd: 7.7577125,
      },
      {
        day: "2026-08-16",
        provider: "codex",
        model: "gpt-5.6-sol",
        inputTokens: 4600,
        cachedInputTokens: 3200,
        cacheWriteTokens: 0,
        outputTokens: 400,
        reasoningTokens: 0,
        costUsd: 0.0412,
      },
      {
        day: "2026-08-17",
        provider: "claude",
        model: "claude-haiku-4-5",
        inputTokens: 4,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 40,
        reasoningTokens: 0,
        costUsd: 0.0031,
      },
      {
        day: "2026-08-17",
        provider: "gemini",
        model: "gemini-3-pro",
        inputTokens: 1200,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 90,
        reasoningTokens: 0,
        costUsd: 0.21,
      },
    ]);
  });

  it("reads the unified report's `period` as well as a per agent report's `date`", () => {
    const rows = parseUnifiedDaily({
      daily: [
        {
          period: "2026-08-16",
          agent: "all",
          agents: [{ agent: "claude", modelBreakdowns: [{ modelName: "claude-opus-5", cost: 1 }] }],
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.day).toBe("2026-08-16");
  });

  it("ignores a report it cannot read rather than inventing days", () => {
    expect(parseUnifiedDaily({ daily: [{ date: "yesterday", agents: [] }] })).toEqual([]);
    expect(parseUnifiedDaily(null)).toEqual([]);
  });
});

describe("parseCodexReasoning", () => {
  it("keys reasoning tokens by day and model", () => {
    expect(parseCodexReasoning(CODEX).get("2026-08-16 gpt-5.6-sol")).toBe(200);
  });
});

describe("readUsageAggregates", () => {
  it("fills codex reasoning tokens from the codex report", async () => {
    const calls: string[][] = [];
    const rows = await readUsageAggregates({
      since: "2026-08-16",
      exec: async (args) => {
        calls.push(args);
        return JSON.stringify(args[0] === "codex" ? CODEX : UNIFIED);
      },
    });

    expect(calls[0]).toEqual(["daily", "--by-agent", "--json", "--timezone", "UTC", "--since", "20260816"]);
    expect(rows.find((row) => row.provider === "codex")?.reasoningTokens).toBe(200);
    expect(rows.find((row) => row.provider === "claude")?.reasoningTokens).toBe(0);
  });
});

describe("ccusageCommand", () => {
  it("downloads ccusage unless TBM_CCUSAGE points at an install", () => {
    expect(ccusageCommand({})).toEqual(["npx", "-y", "ccusage@latest"]);
    expect(ccusageCommand({ TBM_CCUSAGE: "bun x ccusage" })).toEqual(["bun", "x", "ccusage"]);
  });
});

describe("windowStart", () => {
  const now = new Date("2026-08-17T12:00:00.000Z");

  it("collects everything on a first sync", () => {
    expect(windowStart({ now })).toBeUndefined();
  });

  it("goes back to the backfill window behind the watermark", () => {
    expect(windowStart({ now, watermarkDay: "2026-08-10" })).toBe("2026-08-08");
  });

  it("never starts later than yesterday, however new the watermark is", () => {
    expect(windowStart({ now, watermarkDay: "2026-08-17" })).toBe("2026-08-15");
    expect(windowStart({ now, watermarkDay: "2026-09-30" })).toBe("2026-08-16");
    expect(windowStart({ now, sinceDays: 0 })).toBe("2026-08-16");
  });

  it("honours an explicit --since", () => {
    expect(windowStart({ now, sinceDays: 7, watermarkDay: "2026-08-17" })).toBe("2026-08-10");
  });
});

describe("buildSyncDays", () => {
  const now = new Date("2026-08-17T12:00:00.000Z");
  const receipts = readReceiptStreams(
    { CLAUDE_CONFIG_DIR: fixture("claude"), CODEX_HOME: fixture("codex") },
    "/nonexistent-home",
  );

  it("attaches the receipt stream that belongs to each row", () => {
    const days = buildSyncDays(parseUnifiedDaily(UNIFIED), receipts, { now });

    expect(days.map((day) => [day.day, day.provider, day.model, day.receipts.length])).toEqual([
      ["2026-08-16", "claude", "claude-opus-5", 3],
      ["2026-08-16", "codex", "gpt-5.6-sol", 2],
      ["2026-08-17", "claude", "claude-haiku-4-5", 1],
      ["2026-08-17", "gemini", "gemini-3-pro", 0],
    ]);
  });

  it("sorts hashes so the same machine signs the same bytes twice", () => {
    const [first] = buildSyncDays(parseUnifiedDaily(UNIFIED), receipts, { now });
    expect(first?.receipts).toEqual([...first!.receipts].sort());
  });

  it("attaches Grok receipts to ccusage rows so matching usage can be verified", () => {
    const aggregates = parseUnifiedDaily({
      daily: [{
        period: "2026-08-16",
        agents: [{
          agent: "grok",
          modelBreakdowns: [{
            modelName: "grok-4.6-build",
            inputTokens: 1200,
            cacheReadTokens: 100,
            cacheCreationTokens: 0,
            outputTokens: 90,
            cost: 0.02,
          }],
        }],
      }],
    });
    const streams = readReceiptStreams({ GROK_HOME: fixture("grok") }, "/nonexistent-home");
    const days = buildSyncDays(aggregates, streams, { now });

    // Orphan receipts from other fixture days must not invent usage rows.
    expect(days).toHaveLength(1);
    const row = days[0]!;
    expect(row).toMatchObject({
      day: "2026-08-16",
      provider: "grok",
      model: "grok-4.6-build",
      inputTokens: 1200,
      cachedInputTokens: 100,
      outputTokens: 90,
      costUsd: 0.02,
    });
    expect(row.receipts).toEqual([
      "1697a818b43fa1316cc3ae485ca0648e0765b391a678b63664e6b6adf3f64173",
      "566f42a2cabfb85eacad7731cc3fda788214d6ca96885a580f0516ad2d7ad146",
    ]);
    expect(checkPlausibility({ ...row, receiptCount: row.receipts.length }, { now })).toEqual({
      trustLevel: "verified",
      reasons: [],
    });

    const [withoutStream] = buildSyncDays(aggregates, new Map(), { now });
    expect(checkPlausibility({ ...withoutStream!, receiptCount: 0 }, { now }).trustLevel).toBe("reported");
    expect(buildSyncDays(aggregates, streams, { now, start: "2026-08-17" })).toEqual([]);
  });

  it("drops days outside the window and days that have not happened", () => {
    const days = buildSyncDays(parseUnifiedDaily(UNIFIED), receipts, {
      now: new Date("2026-08-16T12:00:00.000Z"),
      start: "2026-08-16",
    });
    expect(days.map((day) => day.day)).toEqual(["2026-08-16", "2026-08-16"]);
  });

  it("keeps the full archive on a first sync", () => {
    const archive = Array.from({ length: 450 }, (_, index) => ({
      ...parseUnifiedDaily(UNIFIED)[0]!,
      day: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
    }));

    expect(
      buildSyncDays(archive, new Map(), { now: new Date("2026-08-17T12:00:00.000Z") }),
    ).toHaveLength(450);
  });
});

describe("shiftDay", () => {
  it("crosses a month boundary", () => {
    expect(shiftDay("2026-09-01", -2)).toBe("2026-08-30");
  });
});
