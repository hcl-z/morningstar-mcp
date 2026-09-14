#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import type { Server } from "node:http";
import type { Express, Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { normalizeIncomingToken } from "./auth.js";
import { MorningstarClient } from "./client.js";
import { registerTools } from "./tools.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3845;
const MCP_PATH = "/mcp";
const TOKEN_HEADER = "x-morningstar-token";

export interface ServerOptions {
  client: MorningstarClient;
}

export interface HttpAppOptions {
  createClient?: (token: string | undefined) => MorningstarClient;
  host?: string;
}

export interface HttpServerOptions extends HttpAppOptions {
  port?: number;
}

export function createServer(options: ServerOptions): McpServer {
  const server = new McpServer({ name: "morningstar-cn-mcp", version: "0.2.0" });
  registerTools(server, options.client);
  return server;
}

export function createHttpApp(options: HttpAppOptions = {}): Express {
  const host = options.host ?? DEFAULT_HOST;
  const createClient = options.createClient ?? ((token: string | undefined) =>
    new MorningstarClient(token === undefined ? {} : { token }));
  const app = createMcpExpressApp({ host });

  app.post(MCP_PATH, async (req: Request, res: Response) => {
    let token: string | undefined;
    try {
      token = normalizeIncomingToken(req.headers[TOKEN_HEADER]);
    } catch (error) {
      sendJsonRpcError(res, 401, error instanceof Error ? error.message : "Authentication required");
      return;
    }

    const server = createServer({ client: createClient(token) });
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });

    try {
      await server.connect(transport as unknown as Parameters<McpServer["connect"]>[0]);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (!res.headersSent) {
        sendJsonRpcError(res, 500, "Internal server error");
      }
      console.error(error instanceof Error ? error.message : String(error));
    } finally {
      await Promise.allSettled([transport.close(), server.close()]);
    }
  });

  app.get(MCP_PATH, (_req: Request, res: Response) => {
    sendJsonRpcError(res, 405, "Method not allowed");
  });
  app.delete(MCP_PATH, (_req: Request, res: Response) => {
    sendJsonRpcError(res, 405, "Method not allowed");
  });
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  return app;
}

export async function startHttpServer(options: HttpServerOptions = {}): Promise<Server> {
  const host = options.host ?? process.env.MCP_HOST ?? DEFAULT_HOST;
  const port = options.port ?? parsePort(process.env.MCP_PORT);
  const app = createHttpApp({ ...options, host });
  return new Promise<Server>((resolve, reject) => {
    const httpServer = app.listen(port, host, () => resolve(httpServer));
    httpServer.once("error", reject);
  });
}

export async function main(): Promise<void> {
  const host = process.env.MCP_HOST ?? DEFAULT_HOST;
  const port = parsePort(process.env.MCP_PORT);
  await startHttpServer({ host, port });
  console.error(`morningstar-cn-mcp listening at http://${host}:${port}${MCP_PATH}`);
}

function parsePort(value: string | undefined): number {
  if (!value) return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("MCP_PORT must be an integer from 1 to 65535");
  }
  return port;
}

function sendJsonRpcError(res: Response, status: number, message: string): void {
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code: status === 401 ? -32001 : -32000, message },
    id: null,
  });
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
