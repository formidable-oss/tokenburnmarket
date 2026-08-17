/*
  Receipt Streams against synthetic transcripts. The expected hashes are written
  out in full: they are the cross-device dedupe contract, so a change to how a
  receipt is derived has to be a deliberate edit here, not a silent drift.
*/
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  claudeRoots,
  codexRoots,
  readClaudeStreams,
  readCodexStreams,
  readReceiptStreams,
  receiptKey,
} from "./receipts.js";

const fixture = (name: string) =>
  fileURLToPath(new URL(`../test/fixtures/${name}`, import.meta.url));

const CLAUDE = {
  msg1: "22511b756fcc4c4c9e8a940dad27db8bd505a03e4aa58754469e92beb599e787",
  msg2: "89151084df47674ed85397d5d87f5f69b126ec814ff1426b9a9d8e6fbdd00606",
  msg3: "f577b9a3726d3f26ae5c96acdeb41f2bae6aa1915e2044991bb93eadef9c7573",
  msg4: "489cb8088295daa2a7d448e58c8d89812fa8a3e48435133ce51fac72485326af",
};

const CODEX = {
  first: "3ba8360b63d6e55d62177be018e30fa1d09b93964a829a0cc5341c586c138236",
  second: "fbd4cdb36b4d9a85701a32f6f35debd90169907c5422bb8dd80cc6484b6ba54f",
  third: "291ad027b3ea85d65cb0681f10c7897b26f40c27a172bdc2c7119634aae3155c",
};

describe("readClaudeStreams", () => {
  const streams = readClaudeStreams([fixture("claude")]);

  it("hashes message.id and requestId, grouped by UTC day and model", () => {
    expect([...(streams.get(receiptKey("2026-08-16", "claude", "claude-opus-5")) ?? [])].sort()).toEqual(
      [CLAUDE.msg1, CLAUDE.msg2, CLAUDE.msg4].sort(),
    );
    expect([...(streams.get(receiptKey("2026-08-17", "claude", "claude-haiku-4-5")) ?? [])]).toEqual([
      CLAUDE.msg3,
    ]);
  });

  it("collapses a message that a resumed session wrote twice", () => {
    const day = streams.get(receiptKey("2026-08-16", "claude", "claude-opus-5"));
    expect(day?.size).toBe(3);
  });

  it("skips messages with no request id and a half written last line", () => {
    const every = [...streams.values()].flatMap((hashes) => [...hashes]);
    expect(every).toHaveLength(4);
  });

  it("drops days before the window", () => {
    const recent = readClaudeStreams([fixture("claude")], "2026-08-17");
    expect([...recent.keys()]).toEqual([receiptKey("2026-08-17", "claude", "claude-haiku-4-5")]);
  });
});

describe("readCodexStreams", () => {
  const streams = readCodexStreams([fixture("codex")]);

  it("hashes session, ordinal and timestamp per token_count event", () => {
    expect([...(streams.get(receiptKey("2026-08-16", "codex", "gpt-5.6-sol")) ?? [])].sort()).toEqual(
      [CODEX.first, CODEX.second].sort(),
    );
  });

  it("follows the model across turns", () => {
    expect([...(streams.get(receiptKey("2026-08-17", "codex", "gpt-5.6-luna")) ?? [])]).toEqual([
      CODEX.third,
    ]);
  });
});

describe("readReceiptStreams", () => {
  it("merges both adapters and honours CLAUDE_CONFIG_DIR and CODEX_HOME", () => {
    const merged = readReceiptStreams(
      { CLAUDE_CONFIG_DIR: fixture("claude"), CODEX_HOME: fixture("codex") },
      "/nonexistent-home",
    );
    expect([...merged.keys()].sort()).toEqual([
      receiptKey("2026-08-16", "claude", "claude-opus-5"),
      receiptKey("2026-08-16", "codex", "gpt-5.6-sol"),
      receiptKey("2026-08-17", "claude", "claude-haiku-4-5"),
      receiptKey("2026-08-17", "codex", "gpt-5.6-luna"),
    ]);
  });

  it("reads nothing when no agent is installed", () => {
    expect(readReceiptStreams({}, "/nonexistent-home").size).toBe(0);
  });
});

describe("roots", () => {
  it("splits a multi directory CLAUDE_CONFIG_DIR", () => {
    expect(claudeRoots({ CLAUDE_CONFIG_DIR: "/a, /b " }, "/home")).toEqual(["/a", "/b"]);
  });

  it("falls back to the two places Claude Code keeps its config", () => {
    expect(claudeRoots({}, "/home")).toEqual(["/home/.claude", "/home/.config/claude"]);
  });

  it("prefers CODEX_HOME", () => {
    expect(codexRoots({ CODEX_HOME: "/elsewhere" }, "/home")).toEqual(["/elsewhere"]);
    expect(codexRoots({}, "/home")).toEqual(["/home/.codex"]);
  });
});
