import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpApp, createServer } from "../src/index.js";
import { MorningstarClient } from "../src/client.js";
import type { Server } from "node:http";

const connections: Array<{ server: ReturnType<typeof createServer>; client: Client }> = [];
const httpServers: Server[] = [];

afterEach(async () => {
  await Promise.all([
    ...connections.splice(0).map(({ server, client }) => Promise.all([server.close(), client.close()])),
    ...httpServers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })),
  ]);
});

async function connect(request: MorningstarClient["request"]) {
  const mockClient = { request } as MorningstarClient;
  const server = createServer({ client: mockClient });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  connections.push({ server, client });
  return client;
}

describe("Streamable HTTP MCP", () => {
  async function listen(createClient: (token: string | undefined) => MorningstarClient): Promise<URL> {
    const app = createHttpApp({ createClient });
    const server = await new Promise<Server>((resolve) => {
      const started = app.listen(0, "127.0.0.1", () => resolve(started));
    });
    httpServers.push(server);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");
    return new URL(`http://127.0.0.1:${address.port}/mcp`);
  }

  it("allows headerless initialization and tool discovery", async () => {
    const seenTokens: Array<string | undefined> = [];
    const url = await listen((token) => {
      seenTokens.push(token);
      return { request: vi.fn() } as unknown as MorningstarClient;
    });
    const client = new Client({ name: "anonymous-client", version: "1" });
    const transport = new StreamableHTTPClientTransport(url);

    await client.connect(transport as unknown as Parameters<Client["connect"]>[0]);
    const tools = await client.listTools();

    expect(tools.tools).toHaveLength(15);
    expect(seenTokens.every((token) => token === undefined)).toBe(true);
    await client.close();
  });

  it("isolates each request header token", async () => {
    const seenTokens: string[] = [];
    const url = await listen((token) => {
      if (token === undefined) throw new Error("Expected test token");
      seenTokens.push(token);
      return {
        request: vi.fn().mockResolvedValue([]),
      } as unknown as MorningstarClient;
    });

    await Promise.all(["user-a", "user-b"].map(async (token) => {
      const client = new Client({ name: `client-${token}`, version: "1" });
      const transport = new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { "X-Morningstar-Token": token } },
      });
      await client.connect(transport as unknown as Parameters<Client["connect"]>[0]);
      const tools = await client.listTools();
      expect(tools.tools).toHaveLength(15);
      await client.close();
    }));

    expect(new Set(seenTokens)).toEqual(new Set(["user-a", "user-b"]));
    expect(seenTokens.filter((token) => token === "user-a")).toHaveLength(
      seenTokens.filter((token) => token === "user-b").length,
    );
  });
});

describe("MCP tools", () => {
  it("advertises only read-only tools", async () => {
    const client = await connect(vi.fn().mockResolvedValue([]));
    const listed = await client.listTools();
    expect(listed.tools).toHaveLength(15);
    expect(listed.tools.map((tool) => tool.name)).toContain("search_funds");
    expect(listed.tools.map((tool) => tool.name)).toContain("screen_funds");
    expect(listed.tools.map((tool) => tool.name)).toContain("rank_funds_day_end");
    for (const tool of listed.tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.destructiveHint).toBe(false);
    }
  });

  it("validates input before making an upstream request", async () => {
    const request = vi.fn().mockResolvedValue([]);
    const client = await connect(request);
    const result = await client.callTool({ name: "search_funds", arguments: { query: "" } });
    expect(result.isError).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it("calls search and bounds the returned list", async () => {
    const request = vi.fn().mockResolvedValue(Array.from({ length: 10 }, (_, index) => ({ code: index })));
    const client = await connect(request);
    const result = await client.callTool({
      name: "search_funds",
      arguments: { query: "沪深", limit: 3 },
    });
    expect(result.isError).not.toBe(true);
    expect(request).toHaveBeenCalledWith("/cn-api/public/v1/fund-cache?match=%E6%B2%AA%E6%B7%B1");
    expect(result.structuredContent).toEqual({
      data: [{ code: 0 }, { code: 1 }, { code: 2 }],
    });
  });

  it("ranks candidates with latest day-end category ranks", async () => {
    const screenRows = [
      { id: "000001", fundName: "基金一", fundSize: 10, maximumDrawdown_3Y: -1 },
      { id: "000002", fundName: "基金二", fundSize: 20, maximumDrawdown_3Y: -2 },
    ];
    const performances: Record<string, unknown> = {
      "000001": {
        categoryName: "纯债",
        dayEnd: {
          returns: { returnDate: "2026-09-10", M1: 1, M6: 4, Y1: 6 },
          returnRanks: { M1: 5, M6: 10, Y1: 20 },
          investmentsInCategory: { M1: 1000, M6: 1000, Y1: 1000 },
        },
      },
      "000002": {
        categoryName: "纯债",
        dayEnd: {
          returns: { returnDate: "2026-09-10", M1: 2, M6: 5, Y1: 7 },
          returnRanks: { M1: 8, M6: 8, Y1: 8 },
          investmentsInCategory: { M1: 1000, M6: 1000, Y1: 1000 },
        },
      },
    };
    const request = vi.fn(async (path: string) => {
      if (path.startsWith("/cn-api/v2/search/es?")) return { rows: screenRows };
      const code = path.match(/\/funds\/(\d{6})\/performance/)?.[1];
      return performances[code as string];
    });
    const client = await connect(request as unknown as MorningstarClient["request"]);

    const ranked = await client.callTool({
      name: "rank_funds_day_end",
      arguments: { category: "pureBond", periods: ["M1", "M6", "Y1"], candidateLimit: 20, limit: 2 },
    });

    expect(ranked.isError).not.toBe(true);
    const structured = ranked.structuredContent as { data: unknown } | undefined;
    const data = structured?.data as { basis: string; funds: Array<{ code: string }> };
    expect(data.basis).toBe("dayEnd");
    expect(data.funds.map((fund) => fund.code)).toEqual(["000002", "000001"]);
    expect(request).toHaveBeenCalledTimes(5);
  });

  it("returns a structured tool error when a screener field is unknown", async () => {
    const request = vi.fn();
    const client = await connect(request);
    const result = await client.callTool({
      name: "screen_funds",
      arguments: { filters: { madeUpField: "x" } },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("Unknown screener filter field");
    expect(request).not.toHaveBeenCalled();
  });
});
