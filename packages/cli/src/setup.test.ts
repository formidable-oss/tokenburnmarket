import { describe, expect, it } from "vitest";
import { mcpSetupLines } from "./setup";

describe("mcpSetupLines", () => {
  it("prints the agent configuration only, for `mcp setup` at any time", () => {
    const text = mcpSetupLines().join("\n");

    expect(text).toContain("claude mcp add tokenburnmarket -- npx -y tokenburnmarket mcp");
    expect(text).toContain("[mcp_servers.tokenburnmarket]");
    expect(text).not.toContain("daemon");
    expect(text).not.toContain("upload");
  });
});
