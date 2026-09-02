import { McpServer } from "@modelcontextprotocol/server";
import type { McpRequestContext } from "@modelcontextprotocol/server";

import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { registerReadPdfTool } from "./tools/read-pdf.js";

/**
 * Build one isolated MCP server instance for a single protocol connection.
 * The v2 serving entries call this factory for either protocol era.
 */
export function createPagebraidServer(context: McpRequestContext): McpServer {
  if (process.env.PAGEBRAID_PROTOCOL_DEBUG === "1") {
    const protocol = context.era === "modern" ? "2026-07-28" : "2025-11-25";
    console.error(`[pagebraid] protocol=${protocol}`);
  }

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION
  });

  registerReadPdfTool(server);
  return server;
}
