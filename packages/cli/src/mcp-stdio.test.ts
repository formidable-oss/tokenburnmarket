/*
  The one test that runs the thing someone actually installs: the bundle in
  dist, spoken to over stdio by a real MCP client. Everything else in mcp.test.ts
  runs the server in process, which cannot catch a broken bin, a missing shebang
  or a dependency that was bundled away.
*/
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = join(packageDir, "dist", "index.js");

let home: string;

beforeAll(async () => {
  // `pnpm test` can run before `pnpm build`, so build on demand rather than skip.
  if (!existsSync(entry)) {
    execFileSync("npx", ["tsup"], { cwd: packageDir, stdio: "inherit" });
  }
  // An empty HOME means an unconnected machine, which is the state this test
  // wants and, more to the point, leaves the real one alone.
  home = await mkdtemp(join(tmpdir(), "tbm-stdio-"));
}, 180_000);

afterAll(async () => {
  if (home) await rm(home, { recursive: true, force: true });
});

describe("the built server over stdio", () => {
  it("starts, handshakes and lists its tools", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry, "mcp"],
      env: { PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home },
    });
    const client = new Client({ name: "stdio-test", version: "0" });
    await client.connect(transport);

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "list_markets",
      "my_communities",
      "my_stats",
      "place_bet",
      "sync_usage",
    ]);

    // An unconnected machine must answer, not hang or crash.
    const result = await client.callTool({ name: "my_stats", arguments: {} });
    expect(result.isError).toBe(true);

    await client.close();
  }, 60_000);
});
