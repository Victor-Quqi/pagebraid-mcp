import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { SERVER_VERSION } from "../constants.js";
import { TOOL_NAME } from "./constants.js";
import type { CliOptions, ToolArguments } from "./types.js";

export async function callReadPdfTool(options: CliOptions): Promise<CallToolResult> {
  const client = new Client(
    {
      name: "pagebraid-debug",
      version: SERVER_VERSION
    },
    {
      capabilities: {}
    }
  );

  try {
    const transport = new StdioClientTransport({
      command: options.serverCommand,
      args: options.serverArgs,
      cwd: options.serverCwd,
      env: getBudgetEnvironment(),
      stderr: "inherit"
    });

    await client.connect(transport);
    const tools = await client.listTools();
    const hasReadPdf = tools.tools.some(tool => tool.name === TOOL_NAME);
    if (!hasReadPdf) {
      throw new Error(`Connected MCP server does not expose ${TOOL_NAME}.`);
    }

    const toolArguments: ToolArguments = {
      file_path: options.filePath,
      mode: options.mode
    };

    if (options.pages !== undefined) {
      toolArguments.pages = options.pages;
    }

    const result = await client.callTool({
      name: TOOL_NAME,
      arguments: toolArguments
    });

    if (!isCallToolContentResult(result)) {
      throw new Error("MCP tool returned an unsupported task-style result.");
    }

    return result;
  } finally {
    await client.close().catch(() => undefined);
  }
}

function getBudgetEnvironment(): Record<string, string> {
  const entries = Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined &&
      (entry[0].startsWith("PAGEBRAID_") || entry[0] === "MAX_MCP_OUTPUT_TOKENS")
  );

  return Object.fromEntries(entries);
}

function isCallToolContentResult(value: unknown): value is CallToolResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "content" in value &&
    Array.isArray((value as { content?: unknown }).content)
  );
}
