// Canonical JSON: the exact bytes a Device signs and the server verifies.
//
// Two independent serialisations of the same value must produce identical
// bytes, otherwise a valid Sync fails verification. Rules:
//   - object keys sorted by UTF-16 code unit, the order `Array.prototype.sort` gives
//   - no whitespace
//   - `undefined` properties dropped, `undefined` array entries become `null`
//   - only finite numbers, so `NaN` and `Infinity` are rejected rather than nulled
//   - no `toJSON` hooks, no `Date` coercion: callers pass primitives they mean

export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | CanonicalValue[]
  | { [key: string]: CanonicalValue | undefined };

export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalJsonError";
  }
}

/** Deterministic JSON string for `value`. Throws on anything not representable. */
export function canonicalJson(value: unknown): string {
  return write(value, new Set());
}

function write(value: unknown, seen: Set<object>): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new CanonicalJsonError(`cannot canonicalise non-finite number ${value}`);
      }
      // Object.is separates -0 from 0 so the two never sign differently.
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    case "object":
      break;
    default:
      throw new CanonicalJsonError(`cannot canonicalise value of type ${typeof value}`);
  }

  const object = value as object;
  if (seen.has(object)) throw new CanonicalJsonError("cannot canonicalise a cyclic value");
  seen.add(object);
  try {
    if (Array.isArray(object)) {
      return `[${object.map((item) => (item === undefined ? "null" : write(item, seen))).join(",")}]`;
    }
    if (Object.getPrototypeOf(object) !== Object.prototype && Object.getPrototypeOf(object) !== null) {
      throw new CanonicalJsonError("cannot canonicalise a class instance; pass plain data");
    }
    const entries = Object.entries(object as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${write(item, seen)}`).join(",")}}`;
  } finally {
    seen.delete(object);
  }
}

/** Canonical JSON as UTF-8 bytes, the message actually passed to Ed25519. */
export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value));
}
