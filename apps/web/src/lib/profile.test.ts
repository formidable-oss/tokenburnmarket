import { describe, expect, it } from "vitest";
import { normalizeCountry, normalizeXHandle, safeInternalPath } from "./profile";
import { countries, countryByCode, isCountryCode } from "./countries";

describe("normalizeXHandle", () => {
  it("treats empty input as not set", () => {
    for (const input of ["", "   ", null, undefined]) {
      expect(normalizeXHandle(input)).toEqual({ ok: true, value: null });
    }
  });

  it("strips a leading at sign", () => {
    expect(normalizeXHandle(" @formidablebldrs ")).toEqual({ ok: true, value: "formidablebldrs" });
  });

  it("rejects illegal characters and overlong handles", () => {
    expect(normalizeXHandle("not a handle").ok).toBe(false);
    expect(normalizeXHandle("a".repeat(16)).ok).toBe(false);
    expect(normalizeXHandle("hey!").ok).toBe(false);
  });
});

describe("normalizeCountry", () => {
  it("treats empty input as not set", () => {
    expect(normalizeCountry("")).toEqual({ ok: true, value: null });
  });

  it("uppercases a valid code", () => {
    expect(normalizeCountry("ro")).toEqual({ ok: true, value: "RO" });
  });

  it("rejects codes outside ISO 3166-1 alpha-2", () => {
    expect(normalizeCountry("ZZ").ok).toBe(false);
    expect(normalizeCountry("Romania").ok).toBe(false);
  });
});

describe("countries", () => {
  it("is the full ISO 3166-1 alpha-2 list, unique and named", () => {
    expect(countries).toHaveLength(249);
    expect(new Set(countries.map((c) => c.code)).size).toBe(countries.length);
    expect(countries.every((c) => /^[A-Z]{2}$/.test(c.code) && c.name.length > 1)).toBe(true);
  });

  it("looks up by code, case insensitively", () => {
    expect(countryByCode("gb")?.name).toBe("United Kingdom");
    expect(countryByCode(null)).toBeUndefined();
    expect(isCountryCode("XX")).toBe(false);
  });
});

describe("safeInternalPath", () => {
  it("keeps site-relative paths", () => {
    expect(safeInternalPath("/settings")).toBe("/settings");
  });

  it("falls back for anything that could leave the site", () => {
    expect(safeInternalPath("//evil.example")).toBe("/");
    expect(safeInternalPath("https://evil.example")).toBe("/");
    expect(safeInternalPath(undefined, "/signin")).toBe("/signin");
  });
});
