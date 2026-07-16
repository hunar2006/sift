import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const firstForty = (await readFile(resolve("README.md"), "utf8")).split(/\r?\n/).slice(0, 40).join("\n");
const required = [
  "git clone https://github.com/hunar2006/sift.git",
  "corepack enable",
  "pnpm install --frozen-lockfile",
  "## 60-second tour"
];
const missing = required.filter((text) => !firstForty.includes(text));

if (missing.length > 0) {
  throw new Error(`README first 40 lines must contain: ${missing.join(", ")}`);
}

console.log("README onboarding check passed.");
