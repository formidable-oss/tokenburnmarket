import { describe, expect, it } from "vitest";
import { countries } from "./countries";
import {
  continentOf,
  continents,
  countryContinent,
  regionBySlug,
  regionTabs,
  WORLD,
} from "./regions";

/** The five polar codes nobody lives on, deliberately outside every continent. */
const POLAR = new Set(["AQ", "BV", "GS", "HM", "TF"]);

describe("country to continent map", () => {
  it("places every country except the polar codes", () => {
    const missing = countries
      .map((country) => country.code)
      .filter((code) => !POLAR.has(code) && !countryContinent[code]);
    expect(missing).toEqual([]);
  });

  it("maps no code that is not a country", () => {
    const known = new Set(countries.map((country) => country.code));
    expect(Object.keys(countryContinent).filter((code) => !known.has(code))).toEqual([]);
  });

  it("puts each country on exactly one continent", () => {
    const counts = new Map<string, number>();
    for (const continent of continents) {
      for (const code of Object.keys(countryContinent)) {
        if (countryContinent[code] === continent.slug) {
          counts.set(code, (counts.get(code) ?? 0) + 1);
        }
      }
    }
    expect([...counts.values()].every((count) => count === 1)).toBe(true);
  });

  it("reads a code case insensitively", () => {
    expect(continentOf("ro")).toBe("europe");
    expect(continentOf("RO")).toBe("europe");
    expect(continentOf(null)).toBeUndefined();
  });
});

describe("regionBySlug", () => {
  it("resolves the world", () => {
    expect(regionBySlug("world")).toEqual(WORLD);
  });

  it("resolves a continent to its country list", () => {
    const region = regionBySlug("north-america");
    expect(region?.kind).toBe("continent");
    expect(region?.kind === "continent" && region.countries).toContain("US");
  });

  it("resolves a lowercased country code", () => {
    expect(regionBySlug("ro")).toEqual({
      slug: "ro",
      kind: "country",
      name: "Romania",
      country: "RO",
    });
  });

  it("rejects anything else", () => {
    expect(regionBySlug("atlantis")).toBeNull();
    expect(regionBySlug("zz")).toBeNull();
    expect(regionBySlug("")).toBeNull();
  });
});

describe("regionTabs", () => {
  it("leads with the world, then continents, then Romania", () => {
    const slugs = regionTabs(null).map((region) => region.slug);
    expect(slugs[0]).toBe("world");
    expect(slugs.slice(1, 7)).toEqual(continents.map((continent) => continent.slug));
    expect(slugs.at(-1)).toBe("ro");
  });

  it("adds the viewer's country after Romania", () => {
    expect(regionTabs("JP").map((region) => region.slug).slice(-2)).toEqual(["ro", "jp"]);
  });

  it("does not repeat Romania for a Romanian viewer", () => {
    const slugs = regionTabs("RO").map((region) => region.slug);
    expect(slugs.filter((slug) => slug === "ro")).toHaveLength(1);
  });
});
