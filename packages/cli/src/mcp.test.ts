import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { ApiClient, type Fetch } from "./api";
import type { DeviceConfig } from "./config";
import { createMcpServer, ListMarketsInput, PlaceBetInput } from "./mcp";

const CONFIG: DeviceConfig = {
  serverUrl: "https://example.test",
  deviceId: "device-1",
  deviceName: "laptop",
  handle: "ada",
  deviceToken: "token-1",
  publicKey: "pk",
  privateKey: "sk",
  connectedAt: "2026-08-01T00:00:00.000Z",
};

interface Call {
  url: string;
  method: string;
  body: unknown;
  authorization: string | null;
}

/** A fetch that answers from a table of routes and records what it was asked. */
function stubFetch(routes: Record<string, unknown>): { fetch: Fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = new URL(url).pathname;
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      authorization: new Headers(init?.headers).get("authorization"),
    });
    const answer = routes[path];
    if (answer === undefined) {
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    }
    return new Response(JSON.stringify(answer), { status: 200 });
  }) as Fetch;
  return { fetch: fetchImpl, calls };
}

async function connectedClient(routes: Record<string, unknown>) {
  const stub = stubFetch(routes);
  const server = createMcpServer({
    loadConfig: () => CONFIG,
    client: (config) => new ApiClient(config, stub.fetch),
    runSync: async (_config, log) => {
      log("2 rows, $1.20, 5 receipts. @ada");
      return 0;
    },
  });

  const client = new Client({ name: "test", version: "0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, calls: stub.calls, close: () => client.close() };
}

const textOf = (result: unknown) =>
  ((result as { content: { type: string; text: string }[] }).content ?? [])
    .map((part) => part.text)
    .join("\n");

const QUOTE = {
  placed: false,
  quote: {
    marketId: "m1",
    outcomeId: "o1",
    side: "buy",
    shares: 12.5,
    credits: 8,
    averagePrice: 0.64,
    priceBefore: 0.6,
    priceAfter: 0.68,
    balance: 100,
    balanceAfter: 92,
  },
};

const FILL = {
  placed: true,
  tradeId: "t1",
  filled: {
    marketId: "m1",
    outcomeId: "o1",
    side: "buy",
    shares: 12.5,
    credits: 8,
    averagePrice: 0.64,
    priceAfter: 0.68,
  },
  balanceAfter: 92,
};

describe("tool schemas", () => {
  it("lists every tool the ticket promises", async () => {
    const { client, close } = await connectedClient({});
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "list_markets",
      "my_communities",
      "my_stats",
      "place_bet",
      "sync_usage",
    ]);
    await close();
  });

  it("publishes place_bet with a confirm flag and no required amount", async () => {
    const { client, close } = await connectedClient({});
    const { tools } = await client.listTools();
    const placeBet = tools.find((tool) => tool.name === "place_bet");

    expect(placeBet?.inputSchema.required).toEqual(["marketId", "outcomeId", "side"]);
    expect(Object.keys(placeBet?.inputSchema.properties ?? {})).toContain("confirm");
    expect(placeBet?.description).toContain("confirm: true");
    await close();
  });

  it("publishes list_markets with the three scopes", async () => {
    const { client, close } = await connectedClient({});
    const { tools } = await client.listTools();
    const listMarkets = tools.find((tool) => tool.name === "list_markets");
    const scope = (listMarkets?.inputSchema.properties as { scope?: { enum?: string[] } })?.scope;
    expect(scope?.enum).toEqual(["community", "global", "all"]);
    await close();
  });

  it("parses what it says it accepts", () => {
    expect(ListMarketsInput.parse({ scope: "global" })).toEqual({ scope: "global" });
    expect(ListMarketsInput.safeParse({ scope: "everything" }).success).toBe(false);
    expect(PlaceBetInput.safeParse({ marketId: "m", outcomeId: "o", side: "buy" }).success).toBe(
      true,
    );
    expect(PlaceBetInput.safeParse({ marketId: "m", outcomeId: "o", side: "hold" }).success).toBe(
      false,
    );
    expect(
      PlaceBetInput.safeParse({ marketId: "m", outcomeId: "o", side: "buy", credits: -1 }).success,
    ).toBe(false);
  });
});

describe("place_bet", () => {
  it("quotes and spends nothing when confirm is missing", async () => {
    const { client, calls, close } = await connectedClient({ "/api/me/trade": QUOTE });

    const result = await client.callTool({
      name: "place_bet",
      arguments: { marketId: "m1", outcomeId: "o1", side: "buy", credits: 10 },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({ confirm: false, credits: 10 });
    expect(textOf(result)).toContain("Call again with confirm: true to place it");
    expect(textOf(result)).toContain("Nothing was spent");
    await close();
  });

  it("treats confirm: false and a non-boolean confirm as a quote", async () => {
    const { client, calls, close } = await connectedClient({ "/api/me/trade": QUOTE });

    await client.callTool({
      name: "place_bet",
      arguments: { marketId: "m1", outcomeId: "o1", side: "buy", credits: 10, confirm: false },
    });
    expect(calls[0]!.body).toMatchObject({ confirm: false });
    await close();
  });

  it("places the trade only when confirm is true", async () => {
    const { client, calls, close } = await connectedClient({ "/api/me/trade": FILL });

    const result = await client.callTool({
      name: "place_bet",
      arguments: { marketId: "m1", outcomeId: "o1", side: "buy", credits: 10, confirm: true },
    });

    expect(calls[0]!.body).toMatchObject({ confirm: true });
    expect(calls[0]!.authorization).toBe("Bearer token-1");
    expect(textOf(result)).toContain("Filled");
    expect(textOf(result)).toContain("t1");
    await close();
  });

  it("refuses an amount it was not given", async () => {
    const { client, calls, close } = await connectedClient({ "/api/me/trade": QUOTE });

    const result = await client.callTool({
      name: "place_bet",
      arguments: { marketId: "m1", outcomeId: "o1", side: "buy" },
    });

    expect(calls).toHaveLength(0);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("credits, or shares");
    await close();
  });
});

describe("read tools", () => {
  it("reports stats in one dense block", async () => {
    const { client, close } = await connectedClient({
      "/api/me/stats": {
        handle: "ada",
        credits: { balance: 421.5 },
        usage: {
          today: { costUsd: 3.4, tokens: 120_000 },
          week: { costUsd: 22.1, tokens: 900_000 },
          month: { costUsd: 81.05, tokens: 4_000_000 },
        },
        trust: [{ provider: "claude-code", level: "verified" }],
        quarantinedDays: 1,
      },
    });

    const printed = textOf(await client.callTool({ name: "my_stats", arguments: {} }));
    expect(printed).toContain("@ada");
    expect(printed).toContain("421.50");
    expect(printed).toContain("$3.40");
    expect(printed).toContain("claude-code verified");
    expect(printed).toContain("quarantined");
    await close();
  });

  it("lists markets with a price against every outcome", async () => {
    const { client, calls, close } = await connectedClient({
      "/api/me/markets": {
        markets: [
          {
            id: "m1",
            question: "Will the team burn 500 dollars this week?",
            scope: "community",
            closesAt: "2026-08-24T00:00:00.000Z",
            communitySlug: "formidable",
            communityName: "Formidable",
            country: null,
            outcomes: [
              { id: "o1", label: "Yes", price: 0.62 },
              { id: "o2", label: "No", price: 0.38 },
            ],
          },
        ],
      },
    });

    const printed = textOf(
      await client.callTool({ name: "list_markets", arguments: { scope: "community" } }),
    );
    expect(calls[0]!.url).toContain("scope=community");
    expect(printed).toContain("62.0c  Yes");
    expect(printed).toContain("c/formidable");
    await close();
  });

  it("says plainly when there is no community", async () => {
    const { client, close } = await connectedClient({ "/api/me/communities": { communities: [] } });
    const printed = textOf(await client.callTool({ name: "my_communities", arguments: {} }));
    expect(printed).toContain("Not in any community yet");
    await close();
  });

  it("returns what a sync printed", async () => {
    const { client, close } = await connectedClient({});
    const printed = textOf(await client.callTool({ name: "sync_usage", arguments: {} }));
    expect(printed).toContain("2 rows");
    await close();
  });
});

describe("without a connected device", () => {
  it("every tool says how to connect instead of failing silently", async () => {
    const server = createMcpServer({ loadConfig: () => null });
    const client = new Client({ name: "test", version: "0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    for (const name of ["my_stats", "my_communities", "list_markets", "sync_usage"]) {
      const result = await client.callTool({ name, arguments: {} });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("tokenburnmarket connect");
    }
    await client.close();
  });
});

describe("api errors", () => {
  it("turns a revoked device into a sentence someone can act on", async () => {
    const revoking = (async () =>
      new Response(JSON.stringify({ error: "revoked" }), { status: 403 })) as Fetch;
    const server = createMcpServer({
      loadConfig: () => CONFIG,
      client: (config) => new ApiClient(config, revoking),
    });
    const client = new Client({ name: "test", version: "0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "my_stats", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("revoked");
    await client.close();
  });
});

describe("syncing itself at startup", () => {
  interface SyncCall {
    config: DeviceConfig;
    printed: string[];
    options: { skipIfSyncedWithinMs?: number } | undefined;
  }

  async function startWith(
    loadConfig: () => DeviceConfig | null,
    behave: (call: SyncCall) => Promise<number> = async () => 0,
  ) {
    const calls: SyncCall[] = [];
    const server = createMcpServer({
      loadConfig,
      runSync: async (config, log, options) => {
        const call: SyncCall = { config, printed: [], options };
        calls.push(call);
        const original = log;
        original("a line the startup sync must swallow");
        return behave(call);
      },
    });
    const client = new Client({ name: "test", version: "0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    // The sync is fire and forget; give it the turn it needs to be recorded.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { client, calls };
  }

  it("runs one throttled sync once the client has initialized", async () => {
    const { client, calls } = await startWith(() => CONFIG);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.config).toBe(CONFIG);
    expect(calls[0]!.options?.skipIfSyncedWithinMs).toBe(10 * 60_000);
    await client.close();
  });

  it("does nothing on a machine that has never connected", async () => {
    const { client, calls } = await startWith(() => null);
    expect(calls).toHaveLength(0);
    await client.close();
  });

  it("keeps serving tools when the startup sync throws", async () => {
    const { client } = await startWith(
      () => CONFIG,
      async () => {
        throw new Error("the network is a lie");
      },
    );
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    await client.close();
  });
});
