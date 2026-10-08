import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { loadImage } from "@napi-rs/canvas";
import { resolveClientBudgetPolicy, estimateClientBytes, estimateClientTokens } from "../src/services/client-budget-policy.ts";
import { resolveImageResourcePolicy } from "../src/services/image-resource-policy.ts";
import { readPdf } from "../src/services/pdf-service.ts";
import { buildReadPdfContent, limitTextBytes } from "../src/services/read-pdf-content.ts";
import { addContentUsages, estimateImageUsage, estimateTextUsage } from "../src/services/token-budget.ts";

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const tempRoot = await realpath(os.tmpdir());
const temp = await mkdtemp(path.join(tempRoot, "pagebraid-grok-budget-"));
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^PAGEBRAID_|^(GROK_)?MAX_MCP_OUTPUT_(BYTES|TOKENS)$/i.test(key)));
const policy = (env = {}) => resolveClientBudgetPolicy({ name: "grok-shell-pagebraid" }, env);
const resourcePolicy = resolveImageResourcePolicy({});
const fixture = path.join(temp, "pages.pdf");

// Reproduce Grok's model-facing conversion independently of the server's usage estimates.
function grokBytes(content) {
  return Buffer.byteLength(content.map(block => block.type === "text" ? block.text :
    block.data.length < 1024 ? `data:${block.mimeType};base64,${block.data}` :
    "[image content will be provided separately]").join("\n"), "utf8");
}
async function read(file = fixture, mode = "text_only", env = {}, pages) {
  const result = await readPdf({ file_path: file, mode, pages,
    budget_policy: policy(env), image_resource_policy: resourcePolicy });
  const bytes = grokBytes(buildReadPdfContent(result));
  assert.equal(result.estimated_client_bytes, bytes);
  assert(bytes <= result.byte_budget, `${bytes} exceeds ${result.byte_budget}`);
  assert(result.pages.filter(page => page.image_base64).length <= 5);
  return result;
}

try {
  assert.equal(policy().profile, "grok-build");
  assert.equal(policy().byte_budget, 20000);
  assert.equal(policy().token_budget, null);
  assert.equal(policy({ MAX_MCP_OUTPUT_BYTES: "100" }).byte_budget, 100);
  assert.equal(policy({ MAX_MCP_OUTPUT_BYTES: "100", GROK_MAX_MCP_OUTPUT_BYTES: "200" }).byte_budget, 200);
  assert.equal(policy({ GROK_MAX_MCP_OUTPUT_BYTES: "200", PAGEBRAID_BYTE_BUDGET: "300" }).byte_budget, 300);
  assert.equal(policy({ GROK_MAX_MCP_OUTPUT_BYTES: "0", MAX_MCP_OUTPUT_BYTES: "bad" }).byte_budget, 20000);
  assert.equal(policy({ PAGEBRAID_CLIENT_PROFILE: "codex" }).profile, "codex");
  for (const name of ["codex", "claude-code", "unknown"]) {
    const p = resolveClientBudgetPolicy({ name }, { GROK_MAX_MCP_OUTPUT_BYTES: "1" });
    assert.equal(p.byte_budget, null);
    assert.equal(p.token_budget, name === "codex" ? 11991 : name === "claude-code" ? 25000 : 10000);
  }
  const claudeCode = resolveClientBudgetPolicy({ name: "claude-code" }, {});
  const pageText = estimateTextUsage("x".repeat(402));
  assert.equal(estimateClientTokens(pageText, claudeCode).coarse, null);
  assert.equal(estimateClientTokens(addContentUsages(pageText, estimateImageUsage(10, 10)), claudeCode).coarse, 101 + 1664);
  assert.equal(estimateClientBytes(estimateTextUsage("中文😀")), 10);
  assert.equal(limitTextBytes("中文😀", 8), "中文");
  assert.equal(limitTextBytes("中文😀", 10), "中文😀");
  assert.equal(estimateClientBytes(estimateImageUsage(10, 10, 9, 12)), "data:image/webp;base64,".length + 12);
  assert.equal(estimateClientBytes(estimateImageUsage(10, 10, 768, 1024)), 43);
  await writeFile(fixture, makePdf(Array.from({ length: 8 }, (_, i) => (`Page ${i + 1} budget regression. `).repeat(125))));

  const limited = await read();
  assert(limited.truncated && limited.returned_pages.length > 1);
  assert.equal(limited.truncate_reason, "client_byte_budget");
  const rest = await read(fixture, "text_only", {}, `${limited.remaining_ranges[0].start_page}-`);
  assert.deepEqual([...limited.returned_pages, ...rest.returned_pages], [1, 2, 3, 4, 5, 6, 7, 8]);
  const full = await read(fixture, "text_only", { PAGEBRAID_BYTE_BUDGET: "100000" });
  const exact = await read(fixture, "text_only", { PAGEBRAID_BYTE_BUDGET: String(full.estimated_client_bytes) });
  assert.equal(exact.returned_pages.length, 8);
  const below = await read(fixture, "text_only", { PAGEBRAID_BYTE_BUDGET: String(full.estimated_client_bytes - 1) });
  assert.equal(below.returned_pages.length, 7);

  const short = path.join(temp, "short.pdf");
  await writeFile(short, makePdf(["First", "Last"]));
  const shortFull = await read(short);
  assert.equal((await read(short, "text_only", { PAGEBRAID_BYTE_BUDGET: String(shortFull.estimated_client_bytes) })).returned_pages.length, 2);
  const dense = path.join(temp, "dense.pdf");
  await writeFile(dense, makePdf(["Dense text ".repeat(2500)]));
  await assert.rejects(read(dense), /Use image_only/);
  const denseAuto = await read(dense, "auto");
  assert.equal(denseAuto.pages[0].text_omitted, true);
  assert(buildReadPdfContent(denseAuto).some(block => block.type === "text" && block.text.includes("text=omitted")));

  for (const mode of ["auto", "image_only"]) {
    const result = await read(fixture, mode);
    assert.equal(result.returned_pages.length, 5);
    assert.equal(result.truncate_reason, "image_count_limit");
    const atLimit = await read(fixture, mode, { PAGEBRAID_BYTE_BUDGET: String(result.estimated_client_bytes) });
    assert.equal(atLimit.returned_pages.length, 5);
    const rest = await read(fixture, mode, {}, "6-");
    assert.deepEqual(rest.returned_pages, [6, 7, 8]);
  }
  const capped = await readPdf({ file_path: fixture, mode: "image_only", budget_policy: policy(),
    image_resource_policy: resolveImageResourcePolicy({ PAGEBRAID_MAX_IMAGES_PER_RESPONSE: "99" }) });
  assert.equal(capped.pages.length, 5);
  console.log("Source checks: exact byte boundaries, continuation, image caps, dense pages and client policies passed");

  for (const mode of ["legacy", "auto"]) {
    const client = new Client({ name: "grok-shell-pagebraid-codex", version: "1" }, {
      capabilities: {}, versionNegotiation: { mode }
    });
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath,
        args: [path.join(root, "dist/index.js")], env: cleanEnv, stderr: "inherit" }));
      const { tools } = await client.listTools();
      assert.equal(tools.find(tool => tool.name === "read_pdf")?._meta?.["anthropic/maxResultSizeChars"], 500000);
      const result = await client.callTool({ name: "read_pdf", arguments: { file_path: fixture, mode: "image_only" } });
      assert.equal(result.isError, undefined);
      assert.equal(result.content.filter(block => block.type === "image").length, 5);
      assert(grokBytes(result.content) <= 20000);
      const error = await client.callTool({ name: "read_pdf", arguments: { file_path: dense, mode: "text_only" } });
      assert.equal(error.isError, true);
      assert(error.content[0].text.includes("image_only"));
    } finally {
      await client.close();
    }
    console.log(`${mode}: Grok identity detection, oversized-page errors and tool metadata verified`);
  }
  const { stdout: overrideOutput } = await run(process.execPath, [path.join(root, "dist/cli.js"), "read-pdf", fixture,
    "--mode", "text_only", "--out", temp, "--raw-result", "--json"], {
    cwd: root, env: { ...cleanEnv, PAGEBRAID_CLIENT_PROFILE: "grok-build", GROK_MAX_MCP_OUTPUT_BYTES: "8000" },
    windowsHide: true, timeout: 120000, maxBuffer: 8 * 1024 * 1024
  });
  const overrideManifest = JSON.parse(overrideOutput);
  const overrideRaw = JSON.parse(await readFile(overrideManifest.files.raw_result, "utf8"));
  assert(grokBytes(overrideRaw.content) <= 8000);
  assert(overrideRaw.content[0].text.includes("ret=1-2"));


  for (const profile of ["grok-build", "codex", "claude-code", "generic"]) {
    for (const mode of ["auto", "text_only", "image_only"]) {
      const { stdout } = await run(process.execPath, [path.join(root, "dist/cli.js"), "read-pdf", fixture,
        "--mode", mode, "--out", temp, "--raw-result", "--json"], {
        cwd: root, env: { ...cleanEnv, PAGEBRAID_CLIENT_PROFILE: profile },
        windowsHide: true, timeout: 120000, maxBuffer: 8 * 1024 * 1024
      });
      const manifest = JSON.parse(stdout);
      assert.equal(manifest.result.isError, false);
      assert.deepEqual(JSON.parse(await readFile(manifest.files.manifest, "utf8")), manifest);
      const raw = JSON.parse(await readFile(manifest.files.raw_result, "utf8"));
      const images = manifest.content.filter(block => block.type === "image");
      if (profile === "grok-build") {
        assert(grokBytes(raw.content) <= 20000);
        assert.equal(images.length, mode === "text_only" ? 0 : 5);
      }
      for (const block of manifest.content) {
        if (block.type === "text") assert.equal(await readFile(block.path, "utf8"), block.text);
        if (block.type === "image") {
          const bytes = await readFile(block.path);
          assert.equal(bytes.length, block.bytes);
          const image = await loadImage(bytes);
          assert(image.width > 0 && image.height > 0);
        }
      }
      console.log(`${profile}/${mode}: manifest, text and ${images.length} images verified`);
    }
  }
} finally {
  assert.equal(path.dirname(await realpath(temp)), tempRoot);
  assert(path.basename(temp).startsWith("pagebraid-grok-budget-"));
  await rm(temp, { recursive: true, force: true, maxRetries: 3 });
}

function makePdf(texts) {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const kids = [];
  for (const text of texts) {
    const number = objects.length + 1;
    kids.push(`${number} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${number + 1} 0 R >>`);
    const lines = text.match(/.{1,120}/g) ?? [""];
    const stream = `BT /F1 4 Tf 3 TL 12 780 Td\n${lines.map(line => `(${line}) Tj T*`).join("\n")}\nET`;
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${texts.length} >>`;
  const chunks = ["%PDF-1.7\n"];
  const offsets = [0];
  let length = Buffer.byteLength(chunks[0]);
  for (const [index, object] of objects.entries()) {
    offsets.push(length);
    const chunk = `${index + 1} 0 obj\n${object}\nendobj\n`;
    chunks.push(chunk);
    length += Buffer.byteLength(chunk);
  }
  chunks.push(`xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`);
  return Buffer.from(chunks.join(""));
}
