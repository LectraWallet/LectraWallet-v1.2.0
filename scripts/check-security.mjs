import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const root = new URL("..", import.meta.url);
const read = file => readFileSync(new URL(file, root), "utf8");
const failures = [];
const packageJson = JSON.parse(read("package.json"));
const html = read("client/index.html");
const server = read("server/index.ts");
const wallet = read("client/src/pages/Home.tsx");
const transaction = read("client/src/lib/btc.ts");
const browserSecurity = read("client/src/lib/browserSecurity.ts");

if (!existsSync(new URL("pnpm-lock.yaml", root)))
  failures.push("A committed pnpm lockfile is required.");
if (
  !packageJson.packageManager?.startsWith("pnpm@") ||
  !packageJson.packageManager.includes("sha512")
)
  failures.push("packageManager must pin pnpm with an integrity hash.");
if (
  !html.includes("Content-Security-Policy") ||
  !html.includes("frame-ancestors 'none'")
)
  failures.push("Document CSP/frame protection is missing.");
if (
  !server.includes("Content-Security-Policy") ||
  !server.includes("X-Frame-Options")
)
  failures.push("Server security headers are missing.");
if (
  wallet.includes("navigator.clipboard.readText") &&
  (!wallet.includes("Only paste a recovery phrase from a trusted source") ||
    !wallet.includes("writeSafeClipboard"))
)
  failures.push(
    "Recovery phrase clipboard handling must require explicit confirmation and secure clipboard access."
  );
if (
  !browserSecurity.includes("one minute in the background") ||
  !wallet.toLowerCase().includes("hardware wallet")
)
  failures.push("Auto-lock or PSBT hardware workflow is missing.");
if (
  !transaction.includes("validateSignedPsbt") ||
  !transaction.includes("bytesEqual(transaction.unsignedTx")
)
  failures.push(
    "Signed PSBT must be matched against the reviewed unsigned transaction."
  );
if (
  !transaction.includes("selectCoins") ||
  !transaction.includes("DUST_LIMIT_SATS")
)
  failures.push("UTXO selection and dust policy are missing.");

const digest = createHash("sha256")
  .update(`${html}\n${server}\n${wallet}\n${transaction}\n${browserSecurity}`)
  .digest("hex");
if (failures.length) {
  console.error("Security source checks failed:");
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(
  `Security source checks passed. Critical-source SHA-256: ${digest}`
);
