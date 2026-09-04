import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const run = promisify(execFile);
const project = process.cwd();
const npmCli = process.env.npm_execpath;
assert(npmCli, "Run this check with npm run check:package.");
const tempRoot = await realpath(os.tmpdir());
const temp = await mkdtemp(path.join(tempRoot, "pagebraid-package-"));
// Let the isolated install load its own npm configuration and use default PDF budgets.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^npm_config_|^PAGEBRAID_|^MAX_MCP_OUTPUT_TOKENS$/i.test(key)
));
const options = { cwd: temp, env, maxBuffer: 8 * 1024 * 1024, timeout: 120_000, windowsHide: true };

try {
  console.log("Packing release files...");
  const { stdout } = await run(process.execPath, [npmCli, "pack", "--json", "--ignore-scripts", "--pack-destination", temp], { ...options, cwd: project });
  const packed = JSON.parse(stdout);
  const pack = Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
  await writeFile(path.join(temp, "package.json"), '{"name":"pagebraid-package-check","private":true}\n');
  console.log("Installing the archive in an isolated directory...");
  await run(process.execPath, [npmCli, "install", "--ignore-scripts", "--no-audit", "--no-fund", "--registry=https://registry.npmjs.org", path.join(temp, pack.filename)], options);
  console.log("Checking installed files and PDF output...");

  const installed = path.join(temp, "node_modules/pagebraid-mcp");
  const manifest = JSON.parse(await readFile(path.join(installed, "package.json"), "utf8"));
  assert.deepEqual(Object.keys(manifest.dependencies), ["@napi-rs/canvas"]);
  for (const dependency of ["pdfjs-dist", "js-tiktoken", "zod", "@modelcontextprotocol"]) {
    await assert.rejects(readdir(path.join(temp, "node_modules", dependency)), { code: "ENOENT" });
  }
  const notices = await readFile(path.join(installed, "dist/THIRD_PARTY_NOTICES.txt"), "utf8");
  for (const name of ["js-tiktoken@", "pdfjs-dist@", "@modelcontextprotocol/server@", "@modelcontextprotocol/client@", "zod@"]) {
    assert(notices.includes(name), `Missing third-party notice: ${name}`);
  }
  for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
    for (const file of await readdir(path.join(project, "node_modules/pdfjs-dist", directory))) {
      const source = await readFile(path.join(project, "node_modules/pdfjs-dist", directory, file));
      const copied = await readFile(path.join(installed, "dist/pdfjs", directory, file));
      assert(source.equals(copied), `Changed or missing PDF.js resource: ${directory}/${file}`);
    }
  }

  const fixture = path.join(temp, "中文 fixtures", "mixed.pdf");
  await mkdir(path.dirname(fixture));
  await writeFile(fixture, makePdf());
  const cli = path.join(installed, "dist/cli.js");
  for (const mode of ["auto", "text_only", "image_only"]) {
    const { stdout: output } = await run(process.execPath, [cli, "read-pdf", fixture, "--pages", "1-4", "--mode", mode, "--out", path.join(temp, mode), "--json"], options);
    const result = JSON.parse(output);
    assert.equal(result.result.isError, false);
    assert.deepEqual(JSON.parse(await readFile(result.files.manifest, "utf8")), result);
    const text = result.content.filter(block => block.type === "text");
    const images = result.content.filter(block => block.type === "image");
    assert(text[0].text.startsWith("@@PB_META"));
    assert.equal(images.length, mode === "text_only" ? 0 : 4);
    if (mode !== "image_only") {
      assert(text.some(block => block.text.includes("Pagebraid package regression")));
      assert(text.some(block => block.text.replace(/\s/g, "").includes("中文测试")), JSON.stringify(text));
    }
    for (const block of text) assert.equal(await readFile(block.path, "utf8"), block.text);
    for (const block of images) {
      const bytes = await readFile(block.path);
      assert.equal(bytes.length, block.bytes);
      const decoded = await loadImage(bytes);
      assert(decoded.width > 0 && decoded.height > 0 && Math.max(decoded.width, decoded.height) <= 2000);
    }
    if (images.length > 0) {
      const decoded = await loadImage(await readFile(images[3].path));
      const canvas = createCanvas(decoded.width, decoded.height);
      const context = canvas.getContext("2d");
      context.drawImage(decoded, 0, 0);
      const red = context.getImageData(Math.floor(decoded.width / 4), Math.floor(decoded.height / 2), 1, 1).data;
      const blue = context.getImageData(Math.floor(decoded.width * 3 / 4), Math.floor(decoded.height / 2), 1, 1).data;
      assert(red[0] > 150 && red[2] < 100 && blue[2] > 150 && blue[0] < 100, "JPEG2000 colors were not decoded.");
    }
    console.log(`${mode}: manifest, text and ${images.length} images verified`);
  }

  // Exercise CMap and standard-font loading without relying on system fonts.
  const resourceCheck = await run(process.execPath, ["--input-type=module", "-e", `
  import { pathToFileURL } from "node:url";
  import { readFile } from "node:fs/promises";
  import { createRequire } from "node:module";
  import path from "node:path";
  const installed = process.argv[1];
  const fixture = process.argv[2];
  const require = createRequire(path.join(installed, "package.json"));
  const { createCanvas } = require("@napi-rs/canvas");
  const pdfRoot = path.join(installed, "dist/pdfjs");
  const pdfjs = await import(pathToFileURL(path.join(pdfRoot, "pdf.mjs")).href);
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(await readFile(fixture)),
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
    cMapUrl: path.join(pdfRoot, "cmaps") + "/",
    cMapPacked: true,
    standardFontDataUrl: path.join(pdfRoot, "standard_fonts") + "/",
    wasmUrl: path.join(pdfRoot, "wasm") + "/"
  }).promise;
  for (const pageNumber of [1, 2]) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const canvas = createCanvas(viewport.width, viewport.height);
    await page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport }).promise;
  }
  await pdf.destroy();
  `, installed, fixture], options);
  assert(!/Unable to load|UnknownErrorException|ENOENT/.test(resourceCheck.stdout + resourceCheck.stderr), resourceCheck.stdout + resourceCheck.stderr);
  console.log(`Packed archive: ${pack.size} bytes; unpacked: ${pack.unpackedSize} bytes`);
  console.log(`SHA-256: ${createHash("sha256").update(await readFile(path.join(temp, pack.filename))).digest("hex")}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  assert.equal(path.dirname(await realpath(temp)), tempRoot);
  assert(path.basename(temp).startsWith("pagebraid-package-"));
  await rm(temp, { recursive: true, force: true, maxRetries: 3 });
}

function makePdf() {
  const canvas = createCanvas(300, 180);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, 300, 180);
  context.fillStyle = "#164e63";
  context.fillRect(20, 20, 260, 140);
  context.fillStyle = "white";
  context.font = "24px sans-serif";
  context.fillText("Scanned page", 40, 100);
  const jpeg = canvas.toBuffer("image/jpeg");
  // Generated lossless 16x16 JPEG2000: red left half, blue right half.
  const jpeg2000 = Buffer.from("AAAADGpQICANCocKAAAAFGZ0eXBqcDIgAAAAAGpwMiAAAAAtanAyaAAAABZpaGRyAAAAEAAAABAAAwcHAAAAAAAPY29scgEAAAAAABAAAAEManAyY/9P/1EALwAAAAAAEAAAABAAAAAAAAAAAAAAABAAAAAQAAAAAAAAAAAAAwcBAQcBAQcBAf9SAAwAAAABAAQEBAAB/1wAEEBASEhQSEhQSEhQSEhQ/2QAJQABQ3JlYXRlZCBieSBPcGVuSlBFRyB2ZXJzaW9uIDIuNS40/5AACgAAAAAAiAAB/5PH1AQBz8+0CAXfx9QCCM/ADAX/f8HzggAAH8/ACALjx9oKAAI4hym/wPkCAAgTXt/H2ggACPEad8faDgAX17Y8uWM5wfOGABcsqIk6J8faEgAXK8g9+hRQn5/H2g4AIhoJq1qUv8D5AgAhbgf3x9oSACFuDM592A3I0//Z", "base64");
  const stream = (data, dictionary = "") => {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
    return Buffer.concat([Buffer.from(`<< ${dictionary} /Length ${bytes.length} >>\nstream\n`), bytes, Buffer.from("\nendstream")]);
  };
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R 14 0 R] /Count 4 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 6 0 R >> >> /Contents 9 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 7 0 R >> >> /Contents 10 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /XObject << /Im1 11 0 R >> >> /Contents 12 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [8 0 R] >>",
    "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /DW 1000 /FontDescriptor 13 0 R >>",
    stream("BT /F1 16 Tf 20 120 Td (Pagebraid package regression) Tj ET"),
    stream("BT /F1 24 Tf 20 120 Td <4e2d65876d4b8bd5> Tj ET"),
    stream(jpeg, "/Type /XObject /Subtype /Image /Width 300 /Height 180 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode"),
    stream("q 300 0 0 180 0 10 cm /Im1 Do Q"),
    "<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [-25 -254 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 80 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /XObject << /Im1 15 0 R >> >> /Contents 12 0 R >>",
    stream(jpeg2000, "/Type /XObject /Subtype /Image /Width 16 /Height 16 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /JPXDecode")
  ];
  const chunks = [Buffer.from("%PDF-1.7\n")];
  const offsets = [0];
  let length = chunks[0].length;
  for (const [index, object] of objects.entries()) {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), Buffer.from(object), Buffer.from("\nendobj\n")]);
    chunks.push(chunk);
    length += chunk.length;
  }
  chunks.push(Buffer.from(`xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(chunks);
}
