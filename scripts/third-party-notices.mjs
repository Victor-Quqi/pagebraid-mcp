import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const licenseFile = /^(licen[cs]e|notice|copying)([._-]|$)/i;

export async function writeThirdPartyNotices(inputs, pdfjsRoot) {
  const roots = new Set([path.resolve(pdfjsRoot)]);
  for (const input of inputs) {
    if (!input.startsWith("node_modules/")) continue;
    let directory = path.dirname(path.resolve(input));
    while (directory !== path.dirname(directory)) {
      const manifest = path.join(directory, "package.json");
      if (existsSync(manifest)) {
        const info = JSON.parse(await readFile(manifest, "utf8"));
        if (info.name && info.version) {
          roots.add(directory);
          break;
        }
      }
      directory = path.dirname(directory);
    }
  }

  const supplements = JSON.parse(await readFile("third-party/sources.json", "utf8"));
  const sections = ["Third-party notices\n\nThis package includes the following third-party software.\nPDF.js resource directories also contain their original license files."];
  for (const root of [...roots].sort()) {
    const info = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    const notices = [];
    for (const file of (await readdir(root)).sort()) {
      if (licenseFile.test(file)) {
        notices.push(`${file}\n\n${await readFile(path.join(root, file), "utf8")}`);
      }
    }
    for (const supplement of supplements.filter(item => item.package === info.name)) {
      if (supplement.version !== info.version) {
        throw new Error(`Review third-party/sources.json for ${info.name}@${info.version}.`);
      }
      notices.push(`Source: ${supplement.source}\n\n${await readFile(`third-party/${supplement.file}`, "utf8")}`);
    }
    if (notices.length === 0) {
      throw new Error(`Missing license text for bundled dependency ${info.name}@${info.version}.`);
    }
    sections.push(`${info.name}@${info.version}\n${"=".repeat(72)}\n\n${notices.join("\n\n")}`);
  }
  await writeFile("dist/THIRD_PARTY_NOTICES.txt", `${sections.join("\n\n")}\n`);
}
