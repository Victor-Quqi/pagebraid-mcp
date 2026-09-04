import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";

import { writeThirdPartyNotices } from "./third-party-notices.mjs";

const result = await build({
  entryPoints: ["src/index.ts", "src/cli.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  minify: true,
  metafile: true,
  legalComments: "eof",
  external: ["@napi-rs/canvas"],
  define: { __PAGEBRAID_PDFJS_ROOT__: JSON.stringify("./pdfjs/") },
  // Bundled CommonJS dependencies still use require for Node built-ins.
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
  plugins: [{
    name: "local-pdfjs",
    setup(context) {
      context.onResolve({ filter: /^pdfjs-dist\/legacy\/build\/pdf\.mjs$/ }, () => ({
        path: "./pdfjs/pdf.mjs",
        external: true
      }));
    }
  }]
});

// Keep the official PDF.js modules together so their relative worker import works.
const pdfjsRoot = "node_modules/pdfjs-dist";
await mkdir("dist/pdfjs", { recursive: true });
for (const name of ["pdf", "pdf.worker"]) {
  await cp(`${pdfjsRoot}/legacy/build/${name}.min.mjs`, `dist/pdfjs/${name}.mjs`);
}
for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  await cp(`${pdfjsRoot}/${directory}`, `dist/pdfjs/${directory}`, { recursive: true });
}
await cp(`${pdfjsRoot}/LICENSE`, "dist/pdfjs/LICENSE");

const bundledInputs = new Set(Object.values(result.metafile.outputs).flatMap(output =>
  Object.entries(output.inputs).filter(([, input]) => input.bytesInOutput > 0).map(([file]) => file)
));
await writeThirdPartyNotices(bundledInputs, pdfjsRoot);

// Retain the exact bundled versions for release inspection without shipping the build graph.
const { version } = JSON.parse(await readFile(`${pdfjsRoot}/package.json`, "utf8"));
await writeFile("dist/pdfjs/version.json", `${JSON.stringify({ version })}\n`);
