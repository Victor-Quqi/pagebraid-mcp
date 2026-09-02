import { McpServer } from "@modelcontextprotocol/server";
import type { McpRequestContext } from "@modelcontextprotocol/server";

import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { registerReadPdfTool } from "./tools/read-pdf.js";

/**
 * Build one isolated MCP server instance for a single protocol connection.
 * The v2 serving entries call this factory for either protocol era.
 */
export function createPagebraidServer(_context?: McpRequestContext): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION
  });

  registerReadPdfTool(server);
  return server;
}
