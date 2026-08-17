import { describe, expect, it } from "vitest";
import { isAdminHandle, parseAdminHandles } from "./admin";

describe("admin handles", () => {
  it("reads a comma separated list, with or without the at sign", () => {
    expect(parseAdminHandles("@alex, theo ,@Sam")).toEqual(new Set(["alex", "theo", "sam"]));
  });

  it("treats an unset or empty list as nobody", () => {
    expect(parseAdminHandles(undefined).size).toBe(0);
    expect(parseAdminHandles(" , ").size).toBe(0);
    expect(isAdminHandle("alex", undefined)).toBe(false);
  });

  it("matches a handle whatever its case, and never matches nobody", () => {
    expect(isAdminHandle("ALEX", "alex")).toBe(true);
    expect(isAdminHandle("@alex", "alex")).toBe(true);
    expect(isAdminHandle("alexa", "alex")).toBe(false);
    expect(isAdminHandle(null, "alex")).toBe(false);
  });
});
