import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";

const outputRoot = resolve("dist/public");
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile() && entry.name !== "release-manifest.json")
      files.push(path);
  }
}
await walk(outputRoot);
const manifest = {};
for (const file of files.sort()) {
  const bytes = await readFile(file);
  manifest[relative(outputRoot, file)] = createHash("sha256")
    .update(bytes)
    .digest("hex");
}
await writeFile(
  resolve(outputRoot, "release-manifest.json"),
  `${JSON.stringify({ algorithm: "SHA-256", files: manifest }, null, 2)}\n`
);
console.log(`Wrote integrity manifest for ${files.length} release files.`);
