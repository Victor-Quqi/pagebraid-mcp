#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseArgs } from "./cli/args.js";
import { dumpToolResult } from "./cli/dump-result.js";
import { HelpRequest } from "./cli/errors.js";
import { callReadPdfTool } from "./cli/mcp-client.js";
import { printHumanSummary } from "./cli/print.js";
import type { ServerCommand } from "./cli/types.js";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2), getDefaultServer());
  const result = await callReadPdfTool(options);
  const manifest = await dumpToolResult(options, result);

  if (options.json) {
    console.log(JSON.stringify(manifest, null, 2));
  } else {
    printHumanSummary(manifest);
  }

  process.exitCode = result.isError ? 1 : 0;
}

function getDefaultServer(): ServerCommand {
  const cliFile = fileURLToPath(import.meta.url);
  const cliDir = path.dirname(cliFile);

  return {
    command: process.execPath,
    args: [path.join(cliDir, "index.js")]
  };
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof HelpRequest) {
    console.log(message);
    process.exit(0);
  }

  console.error(message);
  process.exit(1);
});
