import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CanonicalJsonError, canonicalBytes, canonicalJson } from "./canonical-json";

describe("canonicalJson", () => {
  it("sorts object keys at every depth", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("is insensitive to the order the object was built in", () => {
    const entries = fc.array(
      fc.tuple(fc.string({ maxLength: 12 }), fc.integer({ min: -1000, max: 1000 })),
      { maxLength: 12 },
    );
    fc.assert(
      fc.property(entries, (pairs) => {
        const forward = Object.fromEntries(pairs);
        const backward = Object.fromEntries([...pairs].reverse());
        // Reversing changes insertion order; duplicate keys keep the last value,
        // so only compare when the keys are distinct.
        if (new Set(pairs.map(([k]) => k)).size !== pairs.length) return;
        expect(canonicalJson(forward)).toBe(canonicalJson(backward));
      }),
    );
  });

  it("preserves array order", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("drops undefined properties and nulls undefined array entries", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalJson([1, undefined, 2])).toBe("[1,null,2]");
  });

  it("normalises negative zero so it cannot sign two ways", () => {
    expect(canonicalJson({ a: -0 })).toBe(canonicalJson({ a: 0 }));
  });

  it("refuses values that cannot round-trip", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(CanonicalJsonError);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(CanonicalJsonError);
    expect(() => canonicalJson(() => 1)).toThrow(CanonicalJsonError);
    expect(() => canonicalJson(new Date())).toThrow(CanonicalJsonError);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow(CanonicalJsonError);
  });

  it("parses back to the same value plain JSON would give", () => {
    // Compared against JSON.stringify rather than the input, because both
    // collapse -0 to 0 and that collapse is the point of the normalisation.
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(JSON.parse(canonicalJson(value))).toEqual(JSON.parse(JSON.stringify(value)));
      }),
      { numRuns: 500 },
    );
  });

  it("encodes to UTF-8 bytes", () => {
    expect(new TextDecoder().decode(canonicalBytes({ a: "ü" }))).toBe('{"a":"ü"}');
  });
});
