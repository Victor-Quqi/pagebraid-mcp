import type { ImageManifestBlock, Manifest, ManifestBlock, TextManifestBlock } from "./types.js";

export function printHumanSummary(manifest: Manifest): void {
  const textBlocks = manifest.content.filter(isTextManifestBlock);
  const imageBlocks = manifest.content.filter(isImageManifestBlock);
  const otherBlocks = manifest.content.filter(block => block.type !== "text" && block.type !== "image");

  console.log(`Tool: ${manifest.tool.name}`);
  console.log(`Result: ${manifest.result.isError ? "error" : "ok"}`);
  console.log(`Run dir: ${manifest.files.run_dir}`);
  console.log(`Manifest: ${manifest.files.manifest}`);

  if (textBlocks.length > 0) {
    console.log("");
    console.log("Text blocks:");
    for (const block of textBlocks) {
      console.log(`[${block.index}] chars=${block.chars} path=${block.path}`);
    }
  }

  if (imageBlocks.length > 0) {
    console.log("");
    console.log("Image blocks:");
    for (const block of imageBlocks) {
      console.log(`[${block.index}] mime=${block.mimeType} bytes=${block.bytes} path=${block.path}`);
    }
  }

  if (otherBlocks.length > 0) {
    console.log("");
    console.log("Other blocks:");
    for (const block of otherBlocks) {
      console.log(`[${block.index}] type=${block.type} path=${block.path}`);
    }
  }

  if (manifest.files.raw_result) {
    console.log("");
    console.log(`Raw result: ${manifest.files.raw_result}`);
  }
}

function isTextManifestBlock(block: ManifestBlock): block is TextManifestBlock {
  return block.type === "text";
}

function isImageManifestBlock(block: ManifestBlock): block is ImageManifestBlock {
  return block.type === "image";
}
