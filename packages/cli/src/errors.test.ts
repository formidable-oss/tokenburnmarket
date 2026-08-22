import { describe, expect, it } from "vitest";
import { describeError } from "./errors.js";

describe("describeError", () => {
  it("unwraps the cause that fetch hides behind two useless words", () => {
    const dns = Object.assign(new Error("getaddrinfo ENOTFOUND tokenburnmarket.com"), {
      code: "ENOTFOUND",
    });
    const failure = new TypeError("fetch failed", { cause: dns });

    expect(describeError(failure)).toBe(
      "fetch failed: getaddrinfo ENOTFOUND tokenburnmarket.com",
    );
  });

  it("adds the code when the message does not already carry it", () => {
    const refused = Object.assign(new Error("connect failed"), { code: "ECONNREFUSED" });

    expect(describeError(new TypeError("fetch failed", { cause: refused }))).toBe(
      "fetch failed: connect failed (ECONNREFUSED)",
    );
  });

  it("walks a chain deeper than one link", () => {
    const root = new Error("socket closed");
    const middle = new Error("request failed", { cause: root });

    expect(describeError(new Error("sync failed", { cause: middle }))).toBe(
      "sync failed: request failed: socket closed",
    );
  });

  it("does not repeat a cause that says the same thing", () => {
    const cause = new Error("fetch failed");

    expect(describeError(new TypeError("fetch failed", { cause }))).toBe("fetch failed");
  });

  it("terminates on a cause cycle", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    (a as { cause?: unknown }).cause = b;

    expect(describeError(b)).toBe("b: a");
  });

  it("falls back to the string form of a thrown non-error", () => {
    expect(describeError("plain string")).toBe("plain string");
    expect(describeError(new Error(""))).toBe("Error");
  });
});
