import { describe, expect, it } from "vitest";
import { usageEnvironment } from "./usage-environment.js";

describe("usageEnvironment", () => {
  it("maps Pi's configured session directory to ccusage", () => {
    expect(usageEnvironment({ PI_CODING_AGENT_SESSION_DIR: "~/pi sessions" }, "/home/dev"))
      .toMatchObject({ PI_AGENT_DIR: "/home/dev/pi sessions" });
    expect(usageEnvironment({ PI_CODING_AGENT_DIR: "~/pi" }, "/home/dev"))
      .toMatchObject({ PI_AGENT_DIR: "/home/dev/pi/sessions" });
  });

  it("keeps an explicit ccusage Pi root and expands multiple homes", () => {
    const env = { PI_AGENT_DIR: "/archive/pi", PI_CODING_AGENT_DIR: "~/pi", CODEX_HOME: "~/one, ~/two" };
    expect(usageEnvironment(env, "/home/dev")).toMatchObject({
      PI_AGENT_DIR: "/archive/pi", CODEX_HOME: "/home/dev/one,/home/dev/two",
    });
    expect(env.CODEX_HOME).toBe("~/one, ~/two");
  });
});
