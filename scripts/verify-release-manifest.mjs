import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve("dist/public");
const manifest = JSON.parse(
  await readFile(resolve(root, "release-manifest.json"), "utf8")
);
let invalid = 0;
for (const [file, expected] of Object.entries(manifest.files)) {
  const actual = createHash("sha256")
    .update(await readFile(resolve(root, file)))
    .digest("hex");
  if (actual !== expected) {
    invalid += 1;
    console.error(`Digest mismatch: ${file}`);
  }
}
if (invalid) process.exit(1);
console.log(
  `Verified ${Object.keys(manifest.files).length} release file digests.`
);
