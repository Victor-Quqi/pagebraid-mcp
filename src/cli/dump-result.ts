import { promises as fs } from "node:fs";
import path from "node:path";

import type { CallToolResult, ContentBlock } from "@modelcontextprotocol/client";

import { TOOL_NAME } from "./constants.js";
import type { CliOptions, Manifest, ManifestBlock, ToolArguments } from "./types.js";

export async function dumpToolResult(options: CliOptions, result: CallToolResult): Promise<Manifest> {
  const generatedAt = new Date().toISOString();
  const runDir = path.resolve(options.outDir, buildRunDirectoryName(generatedAt, options.filePath));
  await fs.mkdir(runDir, { recursive: true });

  const manifestPath = path.join(runDir, "manifest.json");
  const rawResultPath = options.rawResult ? path.join(runDir, "raw-result.json") : undefined;
  const content = await dumpContentBlocks(runDir, result.content);
  const toolArguments: ToolArguments = {
    file_path: options.filePath,
    mode: options.mode
  };

  if (options.pages !== undefined) {
    toolArguments.pages = options.pages;
  }

  const manifest: Manifest = {
    generated_at: generatedAt,
    command: "read-pdf",
    server: {
      command: options.serverCommand,
      args: options.serverArgs,
      cwd: options.serverCwd
    },
    tool: {
      name: TOOL_NAME,
      arguments: toolArguments
    },
    result: {
      isError: result.isError === true
    },
    files: {
      run_dir: runDir,
      manifest: manifestPath,
      ...(rawResultPath ? { raw_result: rawResultPath } : {})
    },
    content
  };

  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  if (rawResultPath) {
    await fs.writeFile(rawResultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }

  return manifest;
}

async function dumpContentBlocks(runDir: string, content: ContentBlock[]): Promise<ManifestBlock[]> {
  const manifestBlocks: ManifestBlock[] = [];

  for (const [index, block] of content.entries()) {
    if (block.type === "text") {
      const filePath = path.join(runDir, `text-block-${formatIndex(index)}.txt`);
      await fs.writeFile(filePath, block.text, "utf8");
      manifestBlocks.push({
        index,
        type: "text",
        chars: block.text.length,
        path: filePath,
        text: block.text
      });
      continue;
    }

    if (block.type === "image") {
      const extension = extensionForMimeType(block.mimeType);
      const filePath = path.join(runDir, `image-block-${formatIndex(index)}.${extension}`);
      const bytes = Buffer.from(block.data, "base64");
      await fs.writeFile(filePath, bytes);
      manifestBlocks.push({
        index,
        type: "image",
        mimeType: block.mimeType,
        base64Chars: block.data.length,
        bytes: bytes.length,
        path: filePath
      });
      continue;
    }

    const filePath = path.join(runDir, `content-block-${formatIndex(index)}.json`);
    await fs.writeFile(filePath, `${JSON.stringify(block, null, 2)}\n`, "utf8");
    manifestBlocks.push({
      index,
      type: block.type,
      path: filePath
    });
  }

  return manifestBlocks;
}

function buildRunDirectoryName(generatedAt: string, filePath: string): string {
  const timestamp = generatedAt.replace(/[:.]/g, "-");
  const basename = path.basename(filePath, path.extname(filePath)) || "pdf";
  return `${timestamp}-${sanitizeFileName(basename)}`;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "pdf";
}

function formatIndex(index: number): string {
  return String(index).padStart(3, "0");
}

function extensionForMimeType(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}
