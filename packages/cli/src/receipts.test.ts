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
  grokRoots,
  readClaudeStreams,
  readCodexStreams,
  readGrokStreams,
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

const GROK = {
  one: "1697a818b43fa1316cc3ae485ca0648e0765b391a678b63664e6b6adf3f64173",
  two: "566f42a2cabfb85eacad7731cc3fda788214d6ca96885a580f0516ad2d7ad146",
  four: "66e7512dd11e5543dde16248516e70f3ebf7dc8f6574357dc027e10aebef9c4a",
  five: "afa28da14648fd77c69379c02505ca35eb5b1c7d60cdaac3f8e2322a7ce4e64c",
  decoy: "ac26345f9523711600546fef30bc7b6a38f214bcdc4af79ca8d5e5aabaf51447",
  odd: "8abdc35ccda56d1b76e87eb26624a5af94306f0666cb606496c71aedec12f339",
  noFields: "8c712b3c6404607bab6421879ce27458bbedcb82f5c21d8a7b2467ff4712a8ba",
  partial: "2615e8f776d5946ad2a234849cca64621b899775934d3507619e8b210768f367",
  millis: "b2030ff92fb5eb83510a236c3f342b48b3248fa78f042a5d238742d112e75db7",
  neg: "ca708b4924ad1d5d3eafe3a4ef8d34446e4354f82db5ded29ca33b2dafb61956",
  half: "c7333c4022602e44cff47ea31bfdae8009578846705a38c5d1419cab64d31e05",
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

describe("readGrokStreams", () => {
  const streams = readGrokStreams([fixture("grok")]);

  it("hashes session and prompt_id per completed turn", () => {
    expect(
      [...(streams.get(receiptKey("2026-08-16", "grok", "grok-4.6-build")) ?? [])].sort(),
    ).toEqual([GROK.one, GROK.two].sort());
  });

  it("files the model under the name ccusage reports, not _meta.modelId", () => {
    // Every fixture event carries `_meta.modelId` ("grok-4.6"), so this fails if
    // the reader ever prefers it. A Receipt filed under `grok-4.6` would never
    // meet its `grok-4.6-build` Usage row, and the day would grade Reported.
    expect(streams.has(receiptKey("2026-08-16", "grok", "grok-4.6"))).toBe(false);
    expect(streams.has(receiptKey("2026-08-17", "grok", "grok-4.5"))).toBe(false);
    expect(streams.has(receiptKey("2026-08-16", "grok", "grok-4.6-build"))).toBe(true);
  });

  it("collapses a turn a resumed session wrote twice", () => {
    // The two `p-two` lines differ in timestamp and eventId. They still collapse
    // to one hash only because the hash is `sessionId:prompt_id` and nothing
    // else: a formula that mixed in the clock or the position would give 3.
    expect(streams.get(receiptKey("2026-08-16", "grok", "grok-4.6-build"))?.size).toBe(2);
  });

  it("files one receipt per model when a turn split across two", () => {
    expect([...(streams.get(receiptKey("2026-08-17", "grok", "grok-4.5-build")) ?? [])].sort()).toEqual(
      [GROK.four, GROK.five].sort(),
    );
    expect([...(streams.get(receiptKey("2026-08-17", "grok", "grok-4.6-build")) ?? [])]).toEqual([
      GROK.five,
    ]);
  });

  it("skips a half written last line", () => {
    // The truncated line carries `turn_completed` and a prompt_id, so it passes
    // the prefilter and reaches JSON.parse; only the try/catch keeps it out.
    const every = [...streams.values()].flatMap((hashes) => [...hashes]);
    expect(every).not.toContain(GROK.half);
  });

  it("reads only updates.jsonl, not the other jsonl files beside it", () => {
    // Keys are `day provider model`, so the decoy can only be caught by its hash.
    const every = [...streams.values()].flatMap((hashes) => [...hashes]);
    expect(every).not.toContain(GROK.decoy);
    expect(every).toHaveLength(9);
  });

  it("skips a model that billed no tokens", () => {
    expect(streams.has(receiptKey("2026-08-18", "grok", "grok-4.6-build"))).toBe(false);
  });

  it("skips a timestamp written in milliseconds instead of seconds", () => {
    // It would otherwise land on a year no Usage row can match, silently.
    const every = [...streams.values()].flatMap((hashes) => [...hashes]);
    expect(every).not.toContain(GROK.millis);
    expect([...streams.keys()].some((key) => !key.startsWith("2026-"))).toBe(false);
  });

  it("keeps a receipt when the billed shape is not recognised", () => {
    // billedZero cuts only an explicit all-zero record; every other shape keeps
    // its Receipt, because dropping a real one thins a day.
    expect([...(streams.get(receiptKey("2026-08-20", "grok", "grok-4.6-build")) ?? [])]).toEqual([
      GROK.odd,
    ]);
    expect([...(streams.get(receiptKey("2026-08-21", "grok", "grok-4.5-build")) ?? [])]).toEqual([
      GROK.noFields,
    ]);
    // A non-numeric token field is not "all zero", so the record is kept.
    expect([...(streams.get(receiptKey("2026-08-22", "grok", "grok-4.6-build")) ?? [])]).toEqual([
      GROK.partial,
    ]);
    // A negative count is not all-zero either: only an explicit zero is dropped.
    expect([...(streams.get(receiptKey("2026-08-23", "grok", "grok-4.6-build")) ?? [])]).toEqual([
      GROK.neg,
    ]);
  });

  it("drops days before the window", () => {
    const recent = readGrokStreams([fixture("grok")], "2026-08-17");
    expect([...recent.keys()].sort()).toEqual(
      [
        receiptKey("2026-08-17", "grok", "grok-4.5-build"),
        receiptKey("2026-08-17", "grok", "grok-4.6-build"),
        receiptKey("2026-08-20", "grok", "grok-4.6-build"),
        receiptKey("2026-08-21", "grok", "grok-4.5-build"),
        receiptKey("2026-08-22", "grok", "grok-4.6-build"),
        receiptKey("2026-08-23", "grok", "grok-4.6-build"),
      ].sort(),
    );
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

  it("includes grok receipts and honours GROK_HOME", () => {
    const merged = readReceiptStreams(
      { GROK_HOME: fixture("grok"), CLAUDE_CONFIG_DIR: fixture("claude") },
      "/nonexistent",
    );
    expect([...(merged.get(receiptKey("2026-08-16", "grok", "grok-4.6-build")) ?? [])].sort()).toEqual(
      [GROK.one, GROK.two].sort(),
    );
    // The other adapters still land alongside it.
    expect(merged.has(receiptKey("2026-08-16", "claude", "claude-opus-5"))).toBe(true);
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

  it("prefers GROK_HOME", () => {
    expect(grokRoots({ GROK_HOME: "/tmp/grok" }, "/home/me")).toEqual(["/tmp/grok"]);
  });

  it("falls back to ~/.grok", () => {
    expect(grokRoots({}, "/home/me")).toEqual(["/home/me/.grok"]);
  });

  it("prefers CODEX_HOME", () => {
    expect(codexRoots({ CODEX_HOME: "/elsewhere" }, "/home")).toEqual(["/elsewhere"]);
    expect(codexRoots({}, "/home")).toEqual(["/home/.codex"]);
  });
});
