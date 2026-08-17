import { describe, expect, it } from "vitest";
import {
  CODE_LENGTH,
  SLUG_MAX,
  generateInviteCode,
  inviteUrl,
  isInviteCode,
  normalizeBio,
  normalizeName,
  normalizeSlug,
  normalizeVisibility,
  rotateInviteCode,
  suggestSlug,
} from "./communities";

describe("suggestSlug", () => {
  it("lowercases and joins words with single hyphens", () => {
    expect(suggestSlug("Formidable Builders")).toBe("formidable-builders");
    expect(suggestSlug("  Late   Night  Agents ")).toBe("late-night-agents");
  });

  it("strips accents and punctuation instead of encoding them", () => {
    expect(suggestSlug("Café Déjà Vu")).toBe("cafe-deja-vu");
    expect(suggestSlug("C++ / Rust @ 3am")).toBe("c-rust-3am");
  });

  it("never leaves a hyphen at either end, including after truncation", () => {
    expect(suggestSlug("---edge---")).toBe("edge");
    const long = suggestSlug(`${"a".repeat(SLUG_MAX)} tail`);
    expect(long.length).toBeLessThanOrEqual(SLUG_MAX);
    expect(long.endsWith("-")).toBe(false);
  });

  it("returns an empty string when there is nothing to slug", () => {
    expect(suggestSlug("!!!")).toBe("");
    expect(suggestSlug("")).toBe("");
  });

  it("always suggests something normalizeSlug accepts, or nothing at all", () => {
    for (const name of ["Formidable", "Café Déjà Vu", "C++ / Rust @ 3am", "9 to 5"]) {
      const slug = suggestSlug(name);
      if (slug.length >= 2) expect(normalizeSlug(slug).ok).toBe(true);
    }
  });
});

describe("normalizeSlug", () => {
  it("accepts lowercase letters, digits and inner hyphens", () => {
    expect(normalizeSlug("burn-club-2")).toEqual({ ok: true, value: "burn-club-2" });
  });

  it("folds case and surrounding space rather than rejecting them", () => {
    expect(normalizeSlug("  Burn-Club ")).toEqual({ ok: true, value: "burn-club" });
  });

  it("rejects empty, short, overlong, edge-hyphened and non-slug input", () => {
    for (const bad of ["", "a", "-burn", "burn-", "burn club", "burn_club", "a".repeat(33)]) {
      expect(normalizeSlug(bad).ok).toBe(false);
    }
  });

  it("rejects slugs reserved for routes", () => {
    expect(normalizeSlug("new").ok).toBe(false);
    expect(normalizeSlug("join").ok).toBe(false);
  });
});

describe("normalizeName and normalizeBio", () => {
  it("collapses whitespace in a name and requires one", () => {
    expect(normalizeName("  Burn   Club ")).toEqual({ ok: true, value: "Burn Club" });
    expect(normalizeName("   ").ok).toBe(false);
    expect(normalizeName("x".repeat(61)).ok).toBe(false);
  });

  it("treats an empty bio as not set", () => {
    expect(normalizeBio("  ")).toEqual({ ok: true, value: null });
    expect(normalizeBio("We burn tokens.")).toEqual({ ok: true, value: "We burn tokens." });
    expect(normalizeBio("x".repeat(281)).ok).toBe(false);
  });
});

describe("normalizeVisibility", () => {
  it("only unlisted opts out of the directory; anything else is public", () => {
    expect(normalizeVisibility("unlisted")).toBe("unlisted");
    expect(normalizeVisibility("public")).toBe("public");
    expect(normalizeVisibility(null)).toBe("public");
    expect(normalizeVisibility("secret")).toBe("public");
  });
});

describe("invite codes", () => {
  it("generates codes of the declared shape", () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateInviteCode();
      expect(code).toHaveLength(CODE_LENGTH);
      expect(isInviteCode(code)).toBe(true);
    }
  });

  it("does not use vowels or look-alike characters", () => {
    const codes = Array.from({ length: 200 }, generateInviteCode).join("");
    expect(codes).not.toMatch(/[aeiloAEILOU]/);
  });

  it("rejects codes of the wrong length, alphabet or type", () => {
    expect(isInviteCode("")).toBe(false);
    expect(isInviteCode("b".repeat(CODE_LENGTH - 1))).toBe(false);
    expect(isInviteCode("b".repeat(CODE_LENGTH + 1))).toBe(false);
    expect(isInviteCode(`a${"b".repeat(CODE_LENGTH - 1)}`)).toBe(false);
    expect(isInviteCode(null)).toBe(false);
  });

  it("rotation always returns a different, valid code", () => {
    for (let i = 0; i < 100; i += 1) {
      const current = generateInviteCode();
      const next = rotateInviteCode(current);
      expect(next).not.toBe(current);
      expect(isInviteCode(next)).toBe(true);
    }
  });

  it("rotation invalidates the old link, which is what makes the old URL dead", () => {
    const current = generateInviteCode();
    const next = rotateInviteCode(current);
    expect(inviteUrl("https://tokenburn.market", next)).not.toBe(
      inviteUrl("https://tokenburn.market", current),
    );
  });
});

describe("inviteUrl", () => {
  it("joins origin and code with exactly one slash", () => {
    expect(inviteUrl("https://tokenburn.market", "abc")).toBe("https://tokenburn.market/join/abc");
    expect(inviteUrl("https://tokenburn.market/", "abc")).toBe("https://tokenburn.market/join/abc");
  });
});
