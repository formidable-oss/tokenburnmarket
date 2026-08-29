import { describe, expect, it } from "vitest";
import { agentSetupPrompt } from "./setup-prompt";

describe("agentSetupPrompt", () => {
  it("hands an agent connection, upload, monitoring, MCP, and verification", () => {
    const prompt = agentSetupPrompt("ada");

    expect(prompt).toContain("for @ada");
    expect(prompt).toContain("npm install --global tokenburnmarket@latest");
    expect(prompt).toContain("command -v tokenburnmarket");
    expect(prompt).toContain("tokenburnmarket connect");
    expect(prompt).toContain("tokenburnmarket sync");
    expect(prompt).toContain("daemon install --interval 15m");
    expect(prompt).toContain("installs and starts the service itself");
    expect(prompt).toContain("tokenburnmarket mcp setup");
    expect(prompt).toContain('"Last sync" have values');
    expect(prompt.split(/\s+/).length).toBeLessThan(210);
  });

  it("does not claim an account for the public docs prompt", () => {
    expect(agentSetupPrompt()).not.toContain("for @");
  });
});
