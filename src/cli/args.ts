import path from "node:path";

import { DEFAULT_OUT_DIR } from "./constants.js";
import { CliError, HelpRequest } from "./errors.js";
import type { CliOptions, ServerCommand } from "./types.js";
import type { ReadMode } from "../types.js";

export function parseArgs(args: string[], defaultServer: ServerCommand): CliOptions {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    throw new HelpRequest(usage());
  }

  const command = args.shift();
  if (command !== "read-pdf") {
    throw new CliError(`Unknown command: ${command ?? ""}\n\n${usage()}`);
  }

  const options: Partial<CliOptions> = {
    mode: "auto",
    outDir: DEFAULT_OUT_DIR,
    json: false,
    rawResult: false,
    serverCwd: process.cwd()
  };

  while (args.length > 0) {
    const arg = args.shift();
    if (!arg) {
      continue;
    }

    switch (arg) {
      case "--help":
      case "-h":
        throw new HelpRequest(usage());
      case "--mode":
        options.mode = parseMode(readOptionValue(args, arg));
        break;
      case "--pages":
        options.pages = readOptionValue(args, arg);
        break;
      case "--out":
        options.outDir = readOptionValue(args, arg);
        break;
      case "--json":
        options.json = true;
        break;
      case "--raw-result":
        options.rawResult = true;
        break;
      case "--server-command":
        options.serverCommand = readOptionValue(args, arg);
        break;
      case "--server-arg":
        options.serverArgs = [...(options.serverArgs ?? []), readOptionValue(args, arg)];
        break;
      case "--server-cwd":
        options.serverCwd = readOptionValue(args, arg);
        break;
      default:
        if (arg.startsWith("-")) {
          throw new CliError(`Unknown option: ${arg}\n\n${usage()}`);
        }
        if (options.filePath) {
          throw new CliError(`Unexpected extra argument: ${arg}\n\n${usage()}`);
        }
        options.filePath = arg;
        break;
    }
  }

  if (!options.filePath) {
    throw new CliError(`Missing PDF file path.\n\n${usage()}`);
  }

  return {
    filePath: options.filePath,
    mode: options.mode ?? "auto",
    pages: options.pages,
    outDir: options.outDir ?? DEFAULT_OUT_DIR,
    json: options.json ?? false,
    rawResult: options.rawResult ?? false,
    serverCommand: options.serverCommand ?? defaultServer.command,
    serverArgs: options.serverArgs ?? (options.serverCommand ? [] : defaultServer.args),
    serverCwd: path.resolve(options.serverCwd ?? process.cwd())
  };
}

function readOptionValue(args: string[], option: string): string {
  const value = args.shift();
  if (!value) {
    throw new CliError(`Missing value for ${option}.\n\n${usage()}`);
  }

  return value;
}

function parseMode(value: string): ReadMode {
  if (value === "auto" || value === "text_only" || value === "image_only") {
    return value;
  }

  throw new CliError(`Invalid mode: ${value}. Expected auto, text_only, or image_only.`);
}

function usage(): string {
  return [
    "Usage:",
    "  pagebraid-debug read-pdf <file_path> [options]",
    "",
    "Options:",
    "  --mode <auto|text_only|image_only>   Default: auto",
    "  --pages <23|23-27|23->               Optional page selector",
    `  --out <dir>                         Default: ${DEFAULT_OUT_DIR}`,
    "  --json                              Print manifest JSON to stdout",
    "  --raw-result                        Also write the raw MCP tool result with image base64",
    "  --server-command <cmd>              Default: current node executable",
    "  --server-arg <arg>                  Repeatable server argument",
    "  --server-cwd <dir>                  Default: current working directory"
  ].join("\n");
}
