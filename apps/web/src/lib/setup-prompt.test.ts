import { describe, expect, it } from "vitest";
import { agentSetupPrompt } from "./setup-prompt";

describe("agentSetupPrompt", () => {
  it("hands an agent connection, upload, monitoring, and verification", () => {
    const prompt = agentSetupPrompt("ada");

    expect(prompt).toContain("for @ada");
    expect(prompt).toContain("npm install --global tokenburnmarket@latest");
    expect(prompt).toContain("command -v tokenburnmarket");
    expect(prompt).toContain("Get-Command tokenburnmarket");
    expect(prompt).toContain("tokenburnmarket connect");
    expect(prompt).toContain("confirm the account in the terminal");
    expect(prompt).toContain("If upload fails, retry with `tokenburnmarket sync`, not connect.");
    expect(prompt).toContain("tokenburnmarket daemon install");
    expect(prompt).not.toContain("--interval");
    expect(prompt).toContain("00:00, 06:00, 12:00 and 18:00 UTC");
    expect(prompt).toContain("installs and starts the service itself");
    expect(prompt).toContain("Otherwise require both sync values.");
    expect(prompt.split(/\s+/).length).toBeLessThan(240);
  });

  it("accepts a connected computer waiting for its first usage", () => {
    const prompt = agentSetupPrompt();

    expect(prompt).toContain('no eligible history and sync reports "Nothing to sync."');
    expect(prompt).toContain('"Synced to" and "Last sync" may remain "never"');
    expect(prompt).toContain("report that the first upload awaits usage");
  });

  it("offers MCP separately without changing agent settings during tracking setup", () => {
    const prompt = agentSetupPrompt();

    expect(prompt).toContain("MCP is optional. Offer it after setup; change agent config only if I ask.");
    expect(prompt).not.toContain("tokenburnmarket mcp setup");
    expect(prompt).not.toContain("my_stats");
  });

  it("does not claim an account for the public docs prompt", () => {
    expect(agentSetupPrompt()).not.toContain("for @");
  });
});
