import { describe, expect, it } from "vitest";
import {
  CONNECT_CODE_TTL_MS,
  connectCodeExpiry,
  connectCodeState,
  formatFingerprint,
  generateConnectCode,
  isApprovable,
  normalizeConnectCode,
  type ConnectCodeRow,
} from "./connect-codes";

const START = new Date("2026-08-17T10:00:00.000Z");
const at = (offsetMs: number) => new Date(START.getTime() + offsetMs);

/** A code that has been created but not yet decided on. */
const pending: ConnectCodeRow = {
  expiresAt: connectCodeExpiry(START),
  approvedAt: null,
  tokenIssuedAt: null,
  deviceToken: null,
};

const approved: ConnectCodeRow = {
  ...pending,
  approvedAt: at(30_000),
  deviceToken: "header.payload.signature",
};

describe("generateConnectCode", () => {
  it("formats as two groups of four from the unambiguous alphabet", () => {
    const code = generateConnectCode((size) => new Uint8Array(size).fill(0));
    expect(code).toBe("0000-0000");
    expect(generateConnectCode((size) => Uint8Array.from({ length: size }, (_, i) => i))).toMatch(
      /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/,
    );
  });

  it("never emits I, L, O or U, which are the characters people mistype", () => {
    for (let byte = 0; byte < 256; byte += 1) {
      const code = generateConnectCode((size) => new Uint8Array(size).fill(byte));
      expect(code).not.toMatch(/[ILOU]/);
    }
  });
});

describe("normalizeConnectCode", () => {
  it("accepts what a Builder is likely to type", () => {
    for (const input of ["abcd-2345", "ABCD2345", " abcd 2345 ".replace(/ /g, ""), "AbCd-2345"]) {
      expect(normalizeConnectCode(input)).toBe("ABCD-2345");
    }
  });

  it("rejects wrong lengths and ambiguous characters", () => {
    for (const input of ["", "ABC-2345", "ABCD-23456", "ABCD-234I", "ABCD-234!"]) {
      expect(normalizeConnectCode(input)).toBeNull();
    }
  });
});

describe("connectCodeState", () => {
  it("is pending while the window is open and nobody has decided", () => {
    expect(connectCodeState(pending, at(0))).toBe("pending");
    expect(connectCodeState(pending, at(CONNECT_CODE_TTL_MS - 1))).toBe("pending");
    expect(isApprovable(pending, at(0))).toBe(true);
  });

  it("expires exactly at the ten minute mark", () => {
    expect(connectCodeState(pending, at(CONNECT_CODE_TTL_MS))).toBe("expired");
    expect(isApprovable(pending, at(CONNECT_CODE_TTL_MS))).toBe(false);
  });

  it("hands the token over once, then reads as expired", () => {
    expect(connectCodeState(approved, at(60_000))).toBe("approved");
    const collected: ConnectCodeRow = { ...approved, deviceToken: null, tokenIssuedAt: at(61_000) };
    expect(connectCodeState(collected, at(62_000))).toBe("expired");
    expect(isApprovable(collected, at(62_000))).toBe(false);
  });

  it("does not honour an approval that landed after the window closed", () => {
    expect(connectCodeState(approved, at(CONNECT_CODE_TTL_MS + 1))).toBe("expired");
  });

  it("treats an unknown code, which is also a rejected one, as expired", () => {
    expect(connectCodeState(null, at(0))).toBe("expired");
    expect(isApprovable(null, at(0))).toBe(false);
  });

  it("stays pending when a token was somehow lost before approval was recorded", () => {
    expect(connectCodeState({ ...pending, approvedAt: at(10) }, at(20))).toBe("pending");
  });
});

describe("formatFingerprint", () => {
  it("shows four groups of four, uppercase", () => {
    expect(formatFingerprint("0123456789abcdef0123456789abcdef")).toBe("0123 4567 89AB CDEF");
  });
});
